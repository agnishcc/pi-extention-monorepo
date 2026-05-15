import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Answer, AskQuestion, AskResult, RenderOption } from "./types";
import { wrapText } from "./utils";

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_MAX_VISIBLE_OPTIONS = 10;
const OVERLAY_PADDING_X = 2;

// ── Overlay frame helpers ──────────────────────────────────────────────────────

function padToWidth(text: string, width: number): string {
	const truncated = truncateToWidth(text, width, "");
	return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

function framePopup(lines: string[], width: number, theme: any, title = ""): string[] {
	if (width < 8) return lines.map((l) => truncateToWidth(l, width, ""));

	const border = (t: string) => theme.fg("borderAccent", t);
	const innerWidth = Math.max(1, width - 2 - OVERLAY_PADDING_X * 2);

	const topBorder = (): string => {
		if (!title) return `${border("┏")}${border("━".repeat(width - 2))}${border("┓")}`;
		const safe = truncateToWidth(title, Math.max(1, width - 6), "…");
		const titleStr = ` ${safe} `;
		const fillW = Math.max(0, width - 2 - visibleWidth(titleStr));
		return `${border("┏")}${theme.fg("accent", titleStr)}${border("━".repeat(fillW))}${border("┓")}`;
	};

	const framed: string[] = [topBorder()];
	for (const line of lines) {
		framed.push(
			`${border("┃")}${" ".repeat(OVERLAY_PADDING_X)}${padToWidth(line, innerWidth)}${" ".repeat(OVERLAY_PADDING_X)}${border("┃")}`,
		);
	}
	framed.push(`${border("┗")}${border("━".repeat(width - 2))}${border("┛")}`);
	return framed.map((l) => truncateToWidth(l, width, ""));
}

// ── Component factory ──────────────────────────────────────────────────────────

/**
 * Builds and returns the TUI component object for the ask_user dialog.
 * Handles both single-question (focused) and multi-question (tabbed wizard) UIs.
 */
export function createAskUserComponent(
	tui: any,
	theme: any,
	done: (result: AskResult) => void,
	questions: AskQuestion[],
	opts?: { header?: string; useOverlay?: boolean },
) {
	const header = opts?.header;
	const useOverlay = opts?.useOverlay ?? false;

	// A Submit tab is needed when there are multiple questions or any multiple-select question.
	const needsSubmitTab = questions.length > 1 || questions.some((q) => q.multiple);
	const totalTabs = questions.length + (needsSubmitTab ? 1 : 0);

	// ── Shared state ──────────────────────────────────────────────────────────
	let currentTab = 0;
	let submitCursor = 0; // cursor row on the Submit tab
	let inputMode = false;
	let inputQuestionId: string | null = null;
	let cachedLines: string[] | undefined;

	/** Committed answers (single-select + text questions). */
	const answers = new Map<string, Answer>();
	/** Selected option values per choice-question tab (multi-select). */
	const multiSelections: Set<string>[] = questions.map(() => new Set());
	/** Free-text entered via the isOther editor, per tab. */
	const customTexts: string[] = questions.map(() => "");
	/** Cursor row (absolute option index) per choice-question tab. */
	const selectedRows: number[] = questions.map(() => 0);
	/** Scroll offset (absolute option index of first visible row) per tab. */
	const scrollOffsets: number[] = questions.map(() => 0);

	// ── Inline editor ─────────────────────────────────────────────────────────
	const editorTheme: EditorTheme = {
		borderColor: (s) => theme.fg("accent", s),
		selectList: {
			selectedPrefix: (t) => theme.fg("accent", t),
			selectedText: (t) => theme.fg("accent", t),
			description: (t) => theme.fg("muted", t),
			scrollInfo: (t) => theme.fg("dim", t),
			noMatch: (t) => theme.fg("warning", t),
		},
	};
	const editor = new Editor(tui, editorTheme);

	// ── Helpers ───────────────────────────────────────────────────────────────

	function refresh() {
		cachedLines = undefined;
		tui.requestRender();
	}

	function submitAll(cancelled: boolean) {
		done({ questions, answers: Array.from(answers.values()), cancelled });
	}

	function currentQuestion(): AskQuestion | undefined {
		return questions[currentTab];
	}

	/** Builds the full options list for a question, auto-appending an isOther option if needed. */
	function optionsFor(q: AskQuestion): RenderOption[] {
		const raw = q.options ?? [];
		const opts: RenderOption[] = raw.map((o) => ({ ...o }));
		if (!opts.some((o) => o.isOther)) {
			opts.push({ value: "__other__", label: q.customLabel ?? "Type something.", isOther: true });
		}
		return opts;
	}

	function currentOptions(): RenderOption[] {
		const q = currentQuestion();
		return q?.type === "choice" ? optionsFor(q) : [];
	}

	function maxVisibleFor(q: AskQuestion): number {
		return Math.max(1, q.maxVisibleOptions ?? DEFAULT_MAX_VISIBLE_OPTIONS);
	}

	function isQuestionAnswered(q: AskQuestion, i: number): boolean {
		if (q.type === "choice" && q.multiple) {
			return multiSelections[i].size > 0 || customTexts[i].trim().length > 0;
		}
		return answers.has(q.id);
	}

	function allAnswered(): boolean {
		return questions.every((q, i) => isQuestionAnswered(q, i));
	}

	/** Clamp selectedRows and scrollOffsets for a choice tab. */
	function clampScroll(tabIndex: number): void {
		const q = questions[tabIndex];
		if (!q || q.type !== "choice") return;
		const total = optionsFor(q).length;
		const visible = maxVisibleFor(q);
		selectedRows[tabIndex] = Math.max(0, Math.min(selectedRows[tabIndex] ?? 0, total - 1));
		if (selectedRows[tabIndex] < scrollOffsets[tabIndex]) {
			scrollOffsets[tabIndex] = selectedRows[tabIndex];
		}
		if (selectedRows[tabIndex] >= scrollOffsets[tabIndex] + visible) {
			scrollOffsets[tabIndex] = selectedRows[tabIndex] - visible + 1;
		}
		scrollOffsets[tabIndex] = Math.max(0, Math.min(scrollOffsets[tabIndex], Math.max(0, total - visible)));
	}

	/** Rebuild the Answer entry for a multiple-select question from its selections + custom text. */
	function updateMultiAnswer(tabIndex: number): void {
		const q = questions[tabIndex];
		if (!q) return;
		const opts = optionsFor(q);
		const selected = Array.from(multiSelections[tabIndex]);
		const custom = customTexts[tabIndex].trim();
		const allValues = custom ? [...selected, custom] : selected;

		if (allValues.length === 0) {
			answers.delete(q.id);
			return;
		}

		const labels = allValues.map((v) => opts.find((o) => o.value === v)?.label ?? v);
		const indices = selected
			.map((v) => {
				const idx = opts.findIndex((o) => o.value === v && !o.isOther);
				return idx >= 0 ? idx + 1 : undefined;
			})
			.filter((x): x is number => x !== undefined);

		answers.set(q.id, {
			id: q.id,
			value: allValues[0]!,
			values: allValues,
			label: labels[0]!,
			labels,
			type: "choice",
			wasCustom: Boolean(custom),
			optionIndices: indices.length ? indices : undefined,
		});
	}

	function saveAnswer(questionId: string, value: string, label: string, wasCustom: boolean, optIndex?: number): void {
		const q = questions.find((x) => x.id === questionId);
		answers.set(questionId, {
			id: questionId,
			value,
			label,
			type: q?.type ?? "text",
			wasCustom,
			optionIndex: optIndex,
		});
	}

	/** After answering a single-select or text question, advance to the next unanswered tab. */
	function advanceAfterAnswer(): void {
		if (!needsSubmitTab) {
			submitAll(false);
			return;
		}
		for (let i = currentTab + 1; i < questions.length; i++) {
			if (!isQuestionAnswered(questions[i]!, i)) {
				switchToTab(i);
				return;
			}
		}
		switchToTab(questions.length); // go to Submit tab
	}

	function switchToTab(tabIndex: number): void {
		currentTab = tabIndex;
		submitCursor = 0;
		const q = questions[tabIndex];
		if (q?.type === "text") {
			inputMode = true;
			inputQuestionId = q.id;
			const existing = answers.get(q.id);
			editor.setText(existing ? existing.label : "");
		} else {
			inputMode = false;
			inputQuestionId = null;
			editor.setText("");
		}
		clampScroll(tabIndex);
		refresh();
	}

	// ── Editor callbacks ──────────────────────────────────────────────────────

	editor.onSubmit = (value) => {
		if (!inputQuestionId) return;
		const q = questions.find((x) => x.id === inputQuestionId);
		if (!q) return;
		const trimmed = value.trim() || "(no response)";
		const tabIndex = questions.indexOf(q);

		if (q.type === "choice") {
			if (q.multiple) {
				customTexts[tabIndex] = trimmed;
				updateMultiAnswer(tabIndex);
				inputMode = false;
				inputQuestionId = null;
				editor.setText("");
				refresh();
			} else {
				saveAnswer(q.id, trimmed, trimmed, true);
				inputMode = false;
				inputQuestionId = null;
				editor.setText("");
				advanceAfterAnswer();
			}
		} else {
			// text question
			saveAnswer(q.id, trimmed, trimmed, true);
			inputMode = false;
			inputQuestionId = null;
			editor.setText("");
			advanceAfterAnswer();
		}
	};

	// ── Input handler ─────────────────────────────────────────────────────────

	function handleInput(data: string) {
		// ── Editor is active ───────────────────────────────────────────────
		if (inputMode) {
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
				const q = currentQuestion();
				if (q?.type === "text") {
					submitAll(true);
				} else {
					// Cancel the inline editor; go back to choice list
					inputMode = false;
					inputQuestionId = null;
					editor.setText("");
					refresh();
				}
				return;
			}
			editor.handleInput(data);
			refresh();
			return;
		}

		// ── Global cancel ──────────────────────────────────────────────────
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			submitAll(true);
			return;
		}

		// ── Tab bar navigation ─────────────────────────────────────────────
		if (needsSubmitTab) {
			if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
				switchToTab((currentTab + 1) % totalTabs);
				return;
			}
			if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
				switchToTab((currentTab - 1 + totalTabs) % totalTabs);
				return;
			}
		}

		// ── Submit tab ─────────────────────────────────────────────────────
		if (needsSubmitTab && currentTab === questions.length) {
			const itemCount = questions.length + 1; // question rows + Submit row
			if (matchesKey(data, Key.up)) {
				submitCursor = Math.max(0, submitCursor - 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.down)) {
				submitCursor = Math.min(itemCount - 1, submitCursor + 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.enter)) {
				if (submitCursor < questions.length) {
					switchToTab(submitCursor);
				} else if (allAnswered()) {
					submitAll(false);
				}
				return;
			}
			return;
		}

		const q = currentQuestion();
		if (!q) return;
		const tabIndex = currentTab;

		// ── Choice question ────────────────────────────────────────────────
		if (q.type === "choice") {
			const opts = currentOptions();
			const maxVisible = maxVisibleFor(q);

			if (matchesKey(data, Key.up)) {
				selectedRows[tabIndex] = Math.max(0, (selectedRows[tabIndex] ?? 0) - 1);
				clampScroll(tabIndex);
				refresh();
				return;
			}
			if (matchesKey(data, Key.down)) {
				selectedRows[tabIndex] = Math.min(opts.length - 1, (selectedRows[tabIndex] ?? 0) + 1);
				clampScroll(tabIndex);
				refresh();
				return;
			}
			// Page up / down
			if (matchesKey(data, Key.pageUp) || data === "-") {
				selectedRows[tabIndex] = Math.max(0, (selectedRows[tabIndex] ?? 0) - maxVisible);
				clampScroll(tabIndex);
				refresh();
				return;
			}
			if (matchesKey(data, Key.pageDown) || data === "=") {
				selectedRows[tabIndex] = Math.min(opts.length - 1, (selectedRows[tabIndex] ?? 0) + maxVisible);
				clampScroll(tabIndex);
				refresh();
				return;
			}

			const isSpaceToggle = data === " " && q.multiple;
			if (matchesKey(data, Key.enter) || isSpaceToggle) {
				const opt = opts[selectedRows[tabIndex] ?? 0];
				if (!opt) return;

				if (opt.isOther) {
					inputMode = true;
					inputQuestionId = q.id;
					const custom = customTexts[tabIndex];
					editor.setText(custom || "");
					refresh();
				} else if (q.multiple) {
					// Toggle multi-select
					if (multiSelections[tabIndex].has(opt.value)) {
						multiSelections[tabIndex].delete(opt.value);
					} else {
						multiSelections[tabIndex].add(opt.value);
					}
					updateMultiAnswer(tabIndex);
					refresh();
				} else {
					// Single-select: save and advance
					const optIdx = selectedRows[tabIndex] ?? 0;
					saveAnswer(q.id, opt.value, opt.label, false, optIdx + 1);
					advanceAfterAnswer();
				}
			}
		}
	}

	// ── Renderer ──────────────────────────────────────────────────────────────

	function render(width: number): string[] {
		if (cachedLines) return cachedLines;

		// When using overlay, content is rendered at innerWidth and then framed.
		const innerWidth = useOverlay ? Math.max(1, width - 2 - OVERLAY_PADDING_X * 2) : width;
		const inner: string[] = [];
		const add = (s: string) => inner.push(truncateToWidth(s, innerWidth));

		const canSubmit = allAnswered();

		// Header (inline mode only — overlay title is shown in the frame border)
		if (!useOverlay && header) {
			add(theme.bold(theme.fg("accent", ` ${header}`)));
			inner.push("");
		}

		// ── Tab bar ─────────────────────────────────────────────────────────
		if (needsSubmitTab) {
			const parts: string[] = ["  "];
			for (let i = 0; i < questions.length; i++) {
				const isActive = i === currentTab;
				const isAnswered = isQuestionAnswered(questions[i]!, i);
				const bullet = isAnswered ? "■" : "□";
				const color: "success" | "muted" = isAnswered ? "success" : "muted";
				const lbl = ` ${bullet} ${questions[i]!.label} `;
				parts.push(isActive ? `${theme.bg("selectedBg", theme.fg("text", lbl))} ` : `${theme.fg(color, lbl)} `);
			}
			const isSubmitActive = currentTab === questions.length;
			const submitLabel = " ✓ Submit ";
			parts.push(
				isSubmitActive
					? theme.bg("selectedBg", theme.fg("text", submitLabel))
					: theme.fg(canSubmit ? "success" : "dim", submitLabel),
			);
			add(parts.join(""));
			inner.push("");
		}

		// ── Content ──────────────────────────────────────────────────────────
		const q = currentQuestion();

		if (needsSubmitTab && currentTab === questions.length) {
			// ── Submit / Review tab ──────────────────────────────────────────
			add(theme.fg("accent", theme.bold(" Review your answers")));
			inner.push("");
			for (let i = 0; i < questions.length; i++) {
				const question = questions[i]!;
				const ans = answers.get(question.id);
				const sel = submitCursor === i;
				const prefix = sel ? theme.fg("accent", "> ") : "  ";
				add(prefix + (sel ? theme.fg("accent", question.prompt) : theme.fg("text", question.prompt)));
				if (ans) {
					const answerText = ans.labels && ans.labels.length > 1 ? ans.labels.join(", ") : ans.label;
					const pre = ans.wasCustom
						? theme.fg("muted", "(wrote) ")
						: theme.fg("dim", ans.optionIndex ? `${ans.optionIndex}. ` : "");
					add(`    ${theme.fg("success", "✓ ")}${pre}${theme.fg(sel ? "accent" : "muted", answerText)}`);
				} else {
					add(
						`    ${theme.fg("warning", "✗ unanswered")}${sel ? theme.fg("dim", " — press Enter to answer") : ""}`,
					);
				}
				inner.push("");
			}
			const submitSel = submitCursor === questions.length;
			const submitPrefix = submitSel ? theme.fg("accent", "> ") : "  ";
			if (canSubmit) {
				add(
					submitPrefix +
						(submitSel ? theme.fg("accent", theme.bold("✓ Submit All")) : theme.fg("success", "✓ Submit All")),
				);
			} else {
				const missing = questions
					.filter((_q, i) => !isQuestionAnswered(questions[i]!, i))
					.map((x) => x.label)
					.join(", ");
				add(`  ${theme.fg("dim", "✓ Submit All")} ${theme.fg("warning", `(unanswered: ${missing})`)}`);
			}
			inner.push("");
			add(theme.fg("dim", " ↑↓ navigate • Enter to edit answer or submit • Tab/←→ switch tab • Esc/Ctrl+C cancel"));
		} else if (q?.type === "text") {
			// ── Text question ────────────────────────────────────────────────
			for (const line of wrapText(q.prompt, innerWidth - 1, 3)) {
				add(theme.fg("text", ` ${line}`));
			}
			if (q.placeholder) add(theme.fg("dim", `   ${q.placeholder}`));
			inner.push("");
			for (const line of editor.render(innerWidth - 2)) add(` ${line}`);
			inner.push("");
			add(theme.fg("dim", " Enter to submit • Esc/Ctrl+C to cancel"));
		} else if (q?.type === "choice") {
			// ── Choice question ──────────────────────────────────────────────
			for (const line of wrapText(q.prompt, innerWidth - 1, 3)) {
				add(theme.fg("text", ` ${line}`));
			}
			if (q.multiple) {
				add(theme.fg("dim", " Space/Enter toggles • Tab to advance when done"));
			}
			inner.push("");

			const tabIndex = currentTab;
			const opts = optionsFor(q);
			const maxVisible = maxVisibleFor(q);
			const start = scrollOffsets[tabIndex] ?? 0;
			const end = Math.min(opts.length, start + maxVisible);
			const scrollable = opts.length > maxVisible;
			const curRow = selectedRows[tabIndex] ?? 0;

			if (inputMode) {
				// Render options list with the inline editor on the isOther row
				for (let i = start; i < end; i++) {
					const opt = opts[i]!;
					const sel = i === curRow;
					const prefix = sel ? theme.fg("accent", "> ") : "  ";
					if (opt.isOther) {
						const filled = customTexts[tabIndex].trim();
						const rowLabel = filled ? `${opt.label}: ${filled}` : opt.label;
						if (q.multiple) {
							const chk = filled ? theme.fg("success", "[x] ") : theme.fg("muted", "[ ] ");
							add(`${prefix}${chk}${theme.fg("accent", `${i + 1}. ${rowLabel} ✎`)}`);
						} else {
							add(`${prefix}${theme.fg("accent", `${i + 1}. ${rowLabel} ✎`)}`);
						}
						const hint = q.customPlaceholder ?? "Type your answer, then press Enter.";
						add(theme.fg("muted", `     ${hint}`));
						for (const line of editor.render(innerWidth - 4)) add(`   ${line}`);
					} else {
						if (q.multiple) {
							const chk = multiSelections[tabIndex].has(opt.value)
								? theme.fg("success", "[x] ")
								: theme.fg("muted", "[ ] ");
							add(
								`${prefix}${chk}${sel ? theme.fg("accent", `${i + 1}. ${opt.label}`) : theme.fg("text", `${i + 1}. ${opt.label}`)}`,
							);
						} else {
							add(
								`${prefix}${sel ? theme.fg("accent", `${i + 1}. ${opt.label}`) : theme.fg("text", `${i + 1}. ${opt.label}`)}`,
							);
						}
						if (opt.description) add(`     ${theme.fg("muted", opt.description)}`);
					}
				}
				inner.push("");
				add(theme.fg("dim", " Enter to submit • Esc to go back"));
			} else {
				// Normal option list
				for (let i = start; i < end; i++) {
					const opt = opts[i]!;
					const sel = i === curRow;
					const prefix = sel ? theme.fg("accent", "> ") : "  ";

					if (opt.isOther) {
						const filled = customTexts[tabIndex].trim();
						const rowLabel = filled ? `${opt.label}: ${filled}` : opt.label;
						if (q.multiple) {
							const chk = filled ? theme.fg("success", "[x] ") : theme.fg("muted", "[ ] ");
							add(
								`${prefix}${chk}${sel ? theme.fg("accent", `${i + 1}. ${rowLabel}`) : theme.fg(filled ? "success" : "text", `${i + 1}. ${rowLabel}`)}`,
							);
						} else {
							const chk = answers.get(q.id)?.wasCustom ? theme.fg("success", " ✓") : "";
							add(
								`${prefix}${sel ? theme.fg("accent", `${i + 1}. ${opt.label}`) : theme.fg("text", `${i + 1}. ${opt.label}`)}${chk}`,
							);
						}
					} else {
						const isChecked = q.multiple
							? multiSelections[tabIndex].has(opt.value)
							: answers.get(q.id)?.value === opt.value && !answers.get(q.id)?.wasCustom;

						if (q.multiple) {
							const chk = isChecked ? theme.fg("success", "[x] ") : theme.fg("muted", "[ ] ");
							add(
								`${prefix}${chk}${sel ? theme.fg("accent", `${i + 1}. ${opt.label}`) : theme.fg(isChecked ? "success" : "text", `${i + 1}. ${opt.label}`)}`,
							);
						} else {
							const chk = isChecked ? theme.fg("success", " ✓") : "";
							add(
								`${prefix}${sel ? theme.fg("accent", `${i + 1}. ${opt.label}`) : theme.fg("text", `${i + 1}. ${opt.label}`)}${chk}`,
							);
						}
						if (opt.description && !q.multiple) add(`     ${theme.fg("muted", opt.description)}`);
					}
				}

				// Scroll indicator
				if (scrollable) {
					add(theme.fg("dim", `   (${start + 1}–${end} of ${opts.length}) ↑↓ scroll, -/= page`));
				}

				// For single-select: show current custom answer below the list
				if (!q.multiple) {
					const existing = answers.get(q.id);
					if (existing?.wasCustom) {
						inner.push("");
						add(
							theme.fg("dim", "   Current: ") +
								theme.fg("success", "✓ ") +
								theme.fg("muted", "(wrote) ") +
								theme.fg("accent", existing.label),
						);
					}
				}

				inner.push("");
				const hintSuffix = needsSubmitTab ? " • Tab/←→ switch tab" : "";
				add(
					theme.fg(
						"dim",
						q.multiple
							? `↑↓ navigate • Space/Enter toggle${hintSuffix} • Esc/Ctrl+C cancel`
							: `↑↓ navigate • Enter select${hintSuffix} • Esc/Ctrl+C cancel`,
					),
				);
			}
		}

		inner.push("");

		// ── Wrap in frame or add horizontal rules ─────────────────────────
		if (useOverlay) {
			cachedLines = framePopup(inner, width, theme, header ?? "");
		} else {
			const hr = theme.fg("accent", "─".repeat(width));
			cachedLines = [hr, ...inner, hr];
		}

		return cachedLines;
	}

	// ── Bootstrap: activate first tab ─────────────────────────────────────────
	switchToTab(0);

	return {
		render,
		invalidate: () => {
			cachedLines = undefined;
		},
		handleInput,
	};
}
