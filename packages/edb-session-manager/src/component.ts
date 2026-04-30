import { SessionManager } from "@mariozechner/pi-coding-agent";
import { fuzzyFilter, Input, Key, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { formatAge, searchText, sessionTitle, shortCwd, writeSessionName } from "./helpers";
import type { Mode, SessionAction, SessionInfo } from "./types";

const LIST_VISIBLE = 10;

// ── Component ──────────────────────────────────────────────────────────────────

export function createSessionComponent(
	tui: any,
	theme: any,
	ctx: any,
	pi: any,
	done: (action?: SessionAction) => void,
) {
	const dim = (s: string) => theme.fg("dim", s);
	const muted = (s: string) => theme.fg("muted", s);
	const accent = (s: string) => theme.fg("accent", s);
	const warning = (s: string) => theme.fg("warning", s);

	const currentSessionPath: string | null = ctx.sessionManager?.getSessionFile?.() ?? null;

	// ── State ──────────────────────────────────────────────────────────────
	let mode: Mode = "browsing";
	let allSessions: SessionInfo[] = [];
	let displayedSessions: SessionInfo[] = [];
	let showAll = false;
	let selected: SessionInfo | null = null;
	let selectedIndex = 0;
	let scrollOffset = 0;
	let loaded = false;
	let renamingSession: SessionInfo | null = null;

	// ── Sub-components ─────────────────────────────────────────────────────
	const searchInput = new Input();
	searchInput.focused = true;

	let renameInput: Input | null = null;

	// ── Data helpers ───────────────────────────────────────────────────────

	function buildDescription(s: SessionInfo): string {
		const isCurrent = s.path === currentSessionPath;
		const isFork = !!s.parentSessionPath;
		const meta = `${formatAge(s.modified)}  ·  ${s.messageCount} msg  ·  ${shortCwd(s.cwd)}`;
		if (isCurrent) return `★ current  ·  ${meta}`;
		if (isFork) return `⑂ fork  ·  ${meta}`;
		return meta;
	}

	function clamp(value: number, min: number, max: number): number {
		return Math.max(min, Math.min(value, max));
	}

	function syncSelection(): void {
		if (displayedSessions.length === 0) {
			selectedIndex = 0;
			scrollOffset = 0;
			selected = null;
			return;
		}

		selectedIndex = clamp(selectedIndex, 0, displayedSessions.length - 1);
		const maxScroll = Math.max(0, displayedSessions.length - LIST_VISIBLE);

		if (selectedIndex < scrollOffset) {
			scrollOffset = selectedIndex;
		} else if (selectedIndex >= scrollOffset + LIST_VISIBLE) {
			scrollOffset = selectedIndex - LIST_VISIBLE + 1;
		}

		scrollOffset = clamp(scrollOffset, 0, maxScroll);
		selected = displayedSessions[selectedIndex] ?? null;
	}

	function setSelectedIndex(index: number): void {
		if (displayedSessions.length === 0) {
			syncSelection();
			return;
		}
		selectedIndex = clamp(index, 0, displayedSessions.length - 1);
		syncSelection();
	}

	function moveSelection(delta: number): void {
		if (displayedSessions.length === 0) return;
		const next = selectedIndex + delta;
		if (next < 0) {
			selectedIndex = displayedSessions.length - 1;
		} else if (next >= displayedSessions.length) {
			selectedIndex = 0;
		} else {
			selectedIndex = next;
		}
		syncSelection();
	}

	function updateFilter(): void {
		const q = searchInput.getValue().trim();
		displayedSessions = q ? fuzzyFilter(allSessions, q, searchText) : [...allSessions];
		selectedIndex = 0;
		scrollOffset = 0;
		syncSelection();
		tui.requestRender();
	}

	async function reloadSessions(): Promise<void> {
		loaded = false;
		tui.requestRender();
		try {
			allSessions = (showAll ? await SessionManager.listAll() : await SessionManager.list(ctx.cwd)).sort(
				(a: SessionInfo, b: SessionInfo) => b.modified.getTime() - a.modified.getTime(),
			);
			loaded = true;
			updateFilter();
		} catch {
			loaded = true;
			displayedSessions = [];
			syncSelection();
			tui.requestRender();
		}
	}

	reloadSessions();

	// ── Rename ─────────────────────────────────────────────────────────────

	function startRename(session: SessionInfo): void {
		renamingSession = session;
		mode = "renaming";
		renameInput = new Input();
		renameInput.focused = true;
		renameInput.setValue(session.name ?? sessionTitle(session));
		renameInput.onSubmit = commitRename;
		renameInput.onEscape = cancelRename;
		tui.requestRender();
	}

	function cancelRename(): void {
		mode = "browsing";
		renameInput = null;
		renamingSession = null;
		tui.requestRender();
	}

	function commitRename(newName: string): void {
		if (!renamingSession || !newName.trim()) {
			cancelRename();
			return;
		}
		const trimmed = newName.trim();
		const target = renamingSession;

		if (target.path === currentSessionPath) {
			// Current session: update live in-memory state via API
			pi.setSessionName(trimmed);
			ctx.ui.setStatus("sm", theme.fg("accent", `📁 ${trimmed}`));
		} else {
			// Other session: append a session_info entry directly to the file
			try {
				writeSessionName(target.path, trimmed);
			} catch {
				/* silent — stale name is not critical */
			}
		}

		// Update in-memory list so the rename is reflected immediately
		const idx = allSessions.findIndex((s) => s.path === target.path);
		if (idx >= 0) allSessions[idx] = { ...allSessions[idx]!, name: trimmed };

		mode = "browsing";
		renameInput = null;
		renamingSession = null;
		updateFilter();
	}

	// ── Rendering ──────────────────────────────────────────────────────────

	function padToWidth(s: string, width: number): string {
		return s + " ".repeat(Math.max(0, width - visibleWidth(s)));
	}

	function fixedRow(s: string, width: number): string {
		return padToWidth(truncateToWidth(s, width, ""), width);
	}

	function renderHeader(width: number): string[] {
		const titlePlain = " ✦ Sessions";
		const wsTab = !showAll ? theme.bold(accent("workspace")) : muted("workspace");
		const allTab = showAll ? theme.bold(accent("all")) : muted("all");
		const tabs = `${wsTab} ${dim("·")} ${allTab}`;

		const gap = Math.max(2, width - visibleWidth(titlePlain) - visibleWidth(tabs) - 1);
		const titleRow = theme.bold(accent(titlePlain)) + " ".repeat(gap) + tabs;

		const prefix = ` ${dim("›")} `;
		const inputLine = searchInput.render(Math.max(1, width - visibleWidth(prefix)))[0] ?? "";
		const searchRow = prefix + inputLine;

		return [fixedRow(titleRow, width), fixedRow(searchRow, width)];
	}

	function renderSessionRow(session: SessionInfo, index: number, width: number): string {
		const isSelected = index === selectedIndex;
		const isCurrent = session.path === currentSessionPath;
		const rawTitle = sessionTitle(session);
		const rawDescription = buildDescription(session);
		const cursor = isSelected ? accent("› ") : "  ";
		const cursorWidth = visibleWidth(cursor);

		let line: string;
		if (width > 48) {
			const maxDescriptionWidth = Math.max(10, Math.min(42, Math.floor(width * 0.45)));
			const description = dim(truncateToWidth(rawDescription, maxDescriptionWidth, "…"));
			const titleWidth = Math.max(1, width - cursorWidth - visibleWidth(description) - 2);
			let title = truncateToWidth(rawTitle, titleWidth, "…");
			if (isCurrent) title = accent(title);
			else if (session.name) title = warning(title);
			if (isSelected) title = theme.bold(title);
			const left = cursor + title;
			const spacing = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(description)));
			line = left + spacing + description;
		} else {
			const titleWidth = Math.max(1, width - cursorWidth);
			let title = truncateToWidth(rawTitle, titleWidth, "…");
			if (isCurrent) title = accent(title);
			else if (session.name) title = warning(title);
			if (isSelected) title = theme.bold(title);
			line = cursor + title;
		}

		line = fixedRow(line, width);
		return isSelected ? theme.bg("selectedBg", line) : line;
	}

	function renderListViewport(width: number): string[] {
		const lines: string[] = [];
		syncSelection();

		if (!loaded) {
			lines.push(fixedRow(dim("  Loading…"), width));
			for (let i = 1; i < LIST_VISIBLE; i++) lines.push(fixedRow("", width));
			lines.push(fixedRow(dim("  Loading sessions…"), width));
			return lines;
		}

		if (displayedSessions.length === 0) {
			const message = searchInput.getValue().trim() ? "  No matches." : "  No sessions found.";
			lines.push(fixedRow(dim(message), width));
			for (let i = 1; i < LIST_VISIBLE; i++) lines.push(fixedRow("", width));
			lines.push(fixedRow(dim("  0 sessions"), width));
			return lines;
		}

		for (let i = 0; i < LIST_VISIBLE; i++) {
			const itemIndex = scrollOffset + i;
			const session = displayedSessions[itemIndex];
			lines.push(session ? renderSessionRow(session, itemIndex, width) : fixedRow(dim("  ~"), width));
		}

		const end = Math.min(scrollOffset + LIST_VISIBLE, displayedSessions.length);
		const scrollPercent =
			displayedSessions.length <= LIST_VISIBLE
				? "All"
				: scrollOffset === 0
					? "Top"
					: end === displayedSessions.length
						? "Bot"
						: `${Math.round((end / displayedSessions.length) * 100)}%`;
		const status = `  ${scrollOffset + 1}-${end} of ${displayedSessions.length} [${scrollPercent}]`;
		lines.push(fixedRow(dim(status), width));
		return lines;
	}

	function renderFooter(width: number): string[] {
		const divider = dim("─".repeat(width));

		if (mode === "renaming" && renamingSession && renameInput) {
			const label = truncateToWidth(sessionTitle(renamingSession), 42, "…");
			const prefix = ` ${accent("✏")}  `;
			const inputLine = renameInput.render(Math.max(1, width - visibleWidth(prefix)))[0] ?? "";
			return [
				fixedRow(divider, width),
				fixedRow(dim(`  Renaming  "${label}"`), width),
				fixedRow(prefix + inputLine, width),
				fixedRow(dim("  Enter confirm  ·  Esc cancel"), width),
			];
		}

		return [
			fixedRow(divider, width),
			fixedRow(
				dim(
					"  ↑↓ navigate  ·  PgUp/PgDn page  ·  Enter resume  ·  n rename  ·  d delete  ·  Tab scope  ·  Esc close",
				),
				width,
			),
		];
	}

	// ── Input handling ─────────────────────────────────────────────────────

	return {
		render(width: number): string[] {
			return [...renderHeader(width), dim("─".repeat(width)), ...renderListViewport(width), ...renderFooter(width)];
		},

		handleInput(data: string): void {
			// Renaming mode: all input goes to the rename Input
			if (mode === "renaming") {
				renameInput!.handleInput(data);
				tui.requestRender();
				return;
			}

			// Esc: clear search if active, else close overlay
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
				if (searchInput.getValue()) {
					searchInput.setValue("");
					updateFilter();
					return;
				}
				done();
				return;
			}

			// Tab: flip scope and reset search
			if (matchesKey(data, Key.tab)) {
				showAll = !showAll;
				searchInput.setValue("");
				reloadSessions();
				return;
			}

			// d / n are action keys only when search bar is empty
			const searchEmpty = !searchInput.getValue();

			if (data === "d" && selected && searchEmpty) {
				done({ type: "delete", data: { path: selected.path, title: sessionTitle(selected) } });
				return;
			}

			if (data === "n" && selected && searchEmpty) {
				startRename(selected);
				return;
			}

			// Enter: resume selected session
			if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
				if (selected) done({ type: "resume", data: { path: selected.path } });
				return;
			}

			// List navigation
			if (matchesKey(data, Key.up) || data === "k") {
				moveSelection(-1);
				tui.requestRender();
				return;
			}

			if (matchesKey(data, Key.down) || data === "j") {
				moveSelection(1);
				tui.requestRender();
				return;
			}

			if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("b"))) {
				setSelectedIndex(selectedIndex - LIST_VISIBLE);
				tui.requestRender();
				return;
			}

			if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("f"))) {
				setSelectedIndex(selectedIndex + LIST_VISIBLE);
				tui.requestRender();
				return;
			}

			if (matchesKey(data, Key.home) || data === "g") {
				setSelectedIndex(0);
				tui.requestRender();
				return;
			}

			if (matchesKey(data, Key.end) || data === "G") {
				setSelectedIndex(displayedSessions.length - 1);
				tui.requestRender();
				return;
			}

			// All other keys feed the search input
			searchInput.handleInput(data);
			updateFilter();
		},

		invalidate(): void {
			searchInput.invalidate();
			renameInput?.invalidate();
		},
	};
}
