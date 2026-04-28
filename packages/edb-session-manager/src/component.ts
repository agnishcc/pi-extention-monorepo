import { SessionManager } from "@mariozechner/pi-coding-agent";
import {
	fuzzyFilter,
	Input,
	Key,
	matchesKey,
	type SelectItem,
	SelectList,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";
import { formatAge, searchText, sessionTitle, shortCwd, writeSessionName } from "./helpers";
import type { Mode, SessionAction, SessionInfo } from "./types";

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

	const currentSessionPath: string | null = ctx.sessionManager?.getSessionFile?.() ?? null;

	// ── State ──────────────────────────────────────────────────────────────
	let mode: Mode = "browsing";
	let allSessions: SessionInfo[] = [];
	let displayedSessions: SessionInfo[] = [];
	let showAll = false;
	let selected: SessionInfo | null = null;
	let loaded = false;
	let renamingSession: SessionInfo | null = null;

	// ── Sub-components ─────────────────────────────────────────────────────
	const searchInput = new Input();
	searchInput.focused = true;

	let renameInput: Input | null = null;

	const selectTheme = {
		selectedPrefix: (t: string) => theme.fg("accent", t),
		selectedText: (t: string) => theme.fg("accent", t),
		description: (t: string) => theme.fg("dim", t),
		scrollInfo: (t: string) => theme.fg("dim", t),
		noMatch: (t: string) => theme.fg("warning", t),
	};

	const list = new SelectList([], 10, selectTheme);

	list.onSelectionChange = (item) => {
		if (item) selected = displayedSessions[Number(item.value)] ?? null;
	};

	// ── Data helpers ───────────────────────────────────────────────────────

	function buildDescription(s: SessionInfo): string {
		const isCurrent = s.path === currentSessionPath;
		const isFork = !!s.parentSessionPath;
		const meta = `${formatAge(s.modified)}  ·  ${s.messageCount} msg  ·  ${shortCwd(s.cwd)}`;
		if (isCurrent) return `★ current  ·  ${meta}`;
		if (isFork) return `⑂ fork  ·  ${meta}`;
		return meta;
	}

	function rebuildListItems(): void {
		const items: SelectItem[] = displayedSessions.map((s, i) => ({
			value: String(i),
			label: sessionTitle(s),
			description: buildDescription(s),
		}));
		(list as any).items = items;
		(list as any).filteredItems = items;
		list.setSelectedIndex(0);
		selected = displayedSessions[0] ?? null;
		list.invalidate();
		tui.requestRender();
	}

	function updateFilter(): void {
		const q = searchInput.getValue().trim();
		displayedSessions = q ? fuzzyFilter(allSessions, q, searchText) : [...allSessions];
		rebuildListItems();
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

		return [titleRow, searchRow];
	}

	function renderBody(width: number): string[] {
		if (!loaded) return [dim("  Loading…")];
		if (displayedSessions.length === 0) {
			return [dim(searchInput.getValue().trim() ? "  No matches." : "  No sessions found.")];
		}
		return list.render(width);
	}

	function renderFooter(width: number): string[] {
		const divider = dim("─".repeat(width));

		if (mode === "renaming" && renamingSession && renameInput) {
			const label = truncateToWidth(sessionTitle(renamingSession), 42, "…");
			const prefix = ` ${accent("✏")}  `;
			const inputLine = renameInput.render(Math.max(1, width - visibleWidth(prefix)))[0] ?? "";
			return [divider, dim(`  Renaming  "${label}"`), prefix + inputLine, dim("  Enter confirm  ·  Esc cancel")];
		}

		return [divider, dim("  ↑↓ navigate  ·  Enter resume  ·  n rename  ·  d delete  ·  Tab scope  ·  Esc close")];
	}

	// ── Input handling ─────────────────────────────────────────────────────

	return {
		render(width: number): string[] {
			return [...renderHeader(width), dim("─".repeat(width)), ...renderBody(width), ...renderFooter(width)];
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

			// Arrow keys navigate the list
			if (
				matchesKey(data, Key.up) ||
				matchesKey(data, Key.down) ||
				matchesKey(data, Key.pageUp) ||
				matchesKey(data, Key.pageDown)
			) {
				list.handleInput(data);
				tui.requestRender();
				return;
			}

			// All other keys feed the search input
			searchInput.handleInput(data);
			updateFilter();
		},

		invalidate(): void {
			searchInput.invalidate();
			list.invalidate();
			renameInput?.invalidate();
		},
	};
}
