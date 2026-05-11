import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { Answer, AskQuestion, AskResult, RenderOption } from "./types";

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
) {
	const isMulti = questions.length > 1;
	const totalTabs = questions.length + 1; // questions + Submit tab

	// ── Shared state ──────────────────────────────────────────────────────────
	let currentTab = 0;
	let optionIndex = 0;
	let inputMode = false;
	let inputQuestionId: string | null = null;
	let cachedLines: string[] | undefined;

	const answers = new Map<string, Answer>();

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

	function currentOptions(): RenderOption[] {
		const q = currentQuestion();
		if (!q || q.type !== "choice") return [];
		const rawOpts = q.options ?? [];
		const opts: RenderOption[] = rawOpts.map((o) => ({
			...o,
			isOther: o.isOther === true ? true : undefined,
		}));
		// If no option is already marked as free-text (isOther), auto-append "Type something."
		if (!opts.some((o) => o.isOther)) {
			opts.push({ value: "__other__", label: "Type something.", isOther: true });
		}
		return opts;
	}

	function allAnswered(): boolean {
		return questions.every((q) => answers.has(q.id));
	}

	function advanceAfterAnswer() {
		if (!isMulti) {
			submitAll(false);
			return;
		}
		for (let i = currentTab + 1; i < questions.length; i++) {
			if (!answers.has(questions[i]!.id)) {
				switchToTab(i);
				return;
			}
		}
		switchToTab(questions.length);
	}

	function saveAnswer(questionId: string, value: string, label: string, wasCustom: boolean, optIndex?: number) {
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

	function switchToTab(tabIndex: number) {
		currentTab = tabIndex;
		optionIndex = 0;
		const q = questions[tabIndex];
		if (q && q.type === "text") {
			inputMode = true;
			inputQuestionId = q.id;
			const existing = answers.get(q.id);
			editor.setText(existing ? existing.label : "");
		} else {
			inputMode = false;
			inputQuestionId = null;
			editor.setText("");
		}
		refresh();
	}

	editor.onSubmit = (value) => {
		if (!inputQuestionId) return;
		const trimmed = value.trim() || "(no response)";
		saveAnswer(inputQuestionId, trimmed, trimmed, true);
		inputMode = false;
		inputQuestionId = null;
		editor.setText("");
		advanceAfterAnswer();
	};

	// ── Input handler ─────────────────────────────────────────────────────────

	function handleInput(data: string) {
		// ── Editor is active ───────────────────────────────────────────────
		if (inputMode) {
			if (matchesKey(data, Key.escape)) {
				const q = currentQuestion();
				if (q?.type === "text") {
					submitAll(true);
				} else {
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

		// ── Tab bar navigation (multi-question only) ───────────────────────
		if (isMulti) {
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
		if (isMulti && currentTab === questions.length) {
			const submitItems = questions.length + 1;
			if (matchesKey(data, Key.up)) {
				optionIndex = Math.max(0, optionIndex - 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.down)) {
				optionIndex = Math.min(submitItems - 1, optionIndex + 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.enter)) {
				if (optionIndex < questions.length) {
					switchToTab(optionIndex);
				} else if (allAnswered()) {
					submitAll(false);
				}
				return;
			}
			if (matchesKey(data, Key.escape)) {
				submitAll(true);
			}
			return;
		}

		const q = currentQuestion();

		// ── Choice question: option navigation ─────────────────────────────
		if (q?.type === "choice") {
			const opts = currentOptions();
			if (matchesKey(data, Key.up)) {
				optionIndex = Math.max(0, optionIndex - 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.down)) {
				optionIndex = Math.min(opts.length - 1, optionIndex + 1);
				refresh();
				return;
			}
			if (matchesKey(data, Key.enter)) {
				const opt = opts[optionIndex];
				if (!opt) return;
				if (opt.isOther) {
					inputMode = true;
					inputQuestionId = q.id;
					const existing = answers.get(q.id);
					editor.setText(existing?.wasCustom ? existing.label : "");
					refresh();
				} else {
					saveAnswer(q.id, opt.value, opt.label, false, optionIndex + 1);
					advanceAfterAnswer();
				}
				return;
			}
			if (matchesKey(data, Key.escape)) {
				submitAll(true);
				return;
			}
		}
	}

	// ── Renderer ──────────────────────────────────────────────────────────────

	function render(width: number): string[] {
		if (cachedLines) return cachedLines;

		const lines: string[] = [];
		const add = (s: string) => lines.push(truncateToWidth(s, width));
		const hr = () => add(theme.fg("accent", "─".repeat(width)));
		hr();

		const canSubmit = allAnswered();

		// ── Tab bar ─────────────────────────────────────────────────────────
		if (isMulti) {
			const parts: string[] = ["  "];
			for (let i = 0; i < questions.length; i++) {
				const isActive = i === currentTab;
				const isAnswered = answers.has(questions[i]!.id);
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
			lines.push("");
		}

		// ── Content ─────────────────────────────────────────────────────────
		const q = currentQuestion();
		const opts = currentOptions();

		if (isMulti && currentTab === questions.length) {
			// Submit tab
			add(theme.fg("accent", theme.bold(" Review your answers")));
			lines.push("");
			for (let i = 0; i < questions.length; i++) {
				const question = questions[i]!;
				const ans = answers.get(question.id);
				const sel = optionIndex === i;
				const prefix = sel ? theme.fg("accent", "> ") : "  ";
				add(prefix + (sel ? theme.fg("accent", question.prompt) : theme.fg("text", question.prompt)));
				if (ans) {
					const pre = ans.wasCustom ? theme.fg("muted", "(wrote) ") : theme.fg("dim", `${ans.optionIndex}. `);
					add(`    ${theme.fg("success", "✓ ")}${pre}${theme.fg(sel ? "accent" : "muted", ans.label)}`);
				} else {
					add(
						`    ${theme.fg("warning", "✗ unanswered")}${sel ? theme.fg("dim", " — press Enter to answer") : ""}`,
					);
				}
				lines.push("");
			}
			const submitSel = optionIndex === questions.length;
			const submitPrefix = submitSel ? theme.fg("accent", "> ") : "  ";
			if (canSubmit) {
				add(
					submitPrefix +
						(submitSel ? theme.fg("accent", theme.bold("✓ Submit All")) : theme.fg("success", "✓ Submit All")),
				);
			} else {
				const missing = questions
					.filter((x) => !answers.has(x.id))
					.map((x) => x.label)
					.join(", ");
				add(`  ${theme.fg("dim", "✓ Submit All")} ${theme.fg("warning", `(unanswered: ${missing})`)}`);
			}
			lines.push("");
			add(theme.fg("dim", " ↑↓ navigate • Enter to edit answer or submit • Tab/←→ switch tab • Esc cancel"));
		} else if (q?.type === "text") {
			add(theme.fg("text", ` ${q.prompt}`));
			if (q.placeholder) add(theme.fg("dim", `   ${q.placeholder}`));
			lines.push("");
			for (const line of editor.render(width - 2)) add(` ${line}`);
			lines.push("");
			add(theme.fg("dim", " Enter to submit • Esc to cancel"));
		} else if (q?.type === "choice") {
			add(theme.fg("text", ` ${q.prompt}`));
			lines.push("");
			if (inputMode) {
				// Inline "other" editor inside option list
				for (let i = 0; i < opts.length; i++) {
					const opt = opts[i]!;
					const selected = i === optionIndex;
					const prefix = selected ? theme.fg("accent", "> ") : "  ";
					if (opt.isOther) {
						add(prefix + theme.fg("accent", `${i + 1}. ${opt.label} ✎`));
					} else {
						add(
							prefix +
								(selected
									? theme.fg("accent", `${i + 1}. ${opt.label}`)
									: theme.fg("text", `${i + 1}. ${opt.label}`)),
						);
						if (opt.description) add(`     ${theme.fg("muted", opt.description)}`);
					}
				}
				lines.push("");
				add(theme.fg("muted", " Your answer:"));
				for (const line of editor.render(width - 2)) add(` ${line}`);
				lines.push("");
				add(theme.fg("dim", " Enter to submit • Esc to go back"));
			} else {
				for (let i = 0; i < opts.length; i++) {
					const opt = opts[i]!;
					const selected = i === optionIndex;
					const isAnswered =
						!opt.isOther && answers.get(q.id)?.value === opt.value && !answers.get(q.id)?.wasCustom;
					const prefix = selected ? theme.fg("accent", "> ") : "  ";
					const checkmark = isAnswered ? theme.fg("success", " ✓") : "";
					add(
						prefix +
							(selected
								? theme.fg("accent", `${i + 1}. ${opt.label}`)
								: theme.fg("text", `${i + 1}. ${opt.label}`)) +
							checkmark,
					);
					if (opt.description) add(`     ${theme.fg("muted", opt.description)}`);
				}
				const existing = answers.get(q.id);
				if (existing?.wasCustom) {
					lines.push("");
					add(
						theme.fg("dim", "   Current: ") +
							theme.fg("success", "✓ ") +
							theme.fg("muted", "(wrote) ") +
							theme.fg("accent", existing.label),
					);
				}
				lines.push("");
				add(
					theme.fg(
						"dim",
						isMulti
							? " ↑↓ navigate • Enter select • Tab/←→ switch tab • Esc cancel"
							: " ↑↓ navigate • Enter select • Esc cancel",
					),
				);
			}
		}

		lines.push("");
		hr();

		cachedLines = lines;
		return lines;
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
