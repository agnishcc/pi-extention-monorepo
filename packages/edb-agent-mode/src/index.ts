/**
 * edb-agent-mode — Agent mode switcher for pi.
 *
 * Loads mode definitions from:
 *   ~/.pi/agent/modes/*.md   (global)
 *   <cwd>/.pi/modes/*.md     (project, overrides global)
 *
 * Each .md file has YAML frontmatter:
 *   name:        canonical mode name
 *   description: shown in the /mode picker
 *   append_mode: "append" (default) | "replace"
 *   model:       optional model override (fuzzy match, e.g. "haiku", "sonnet", "anthropic/claude-haiku-4-5-20251001")
 *
 * Commands:
 *   /mode            — open picker to select or clear a mode
 *   /mode off        — clear the active mode
 *   /mode status     — show current mode details without opening picker
 *
 * Keyboard:
 *   Ctrl+Shift+A     — cycle through agent modes (toggle)
 * Footer: active mode name shown in footer line 2 (right side, after thinking label).
 * System prompt: active mode's body is appended (or replaces) on each turn.
 * Model: if mode defines a model, it is set when mode is activated.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { type ModelRegistry, resolveModel } from "./model-resolver.js";

const ENTRY_TYPE = "agent-mode:active";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ModeConfig {
	name: string;
	description: string;
	appendMode: "append" | "replace";
	/** Optional model string — fuzzy or "provider/modelId". Set when mode is activated. */
	model?: string;
	systemPrompt: string;
	source: "global" | "project";
}

// ── State ─────────────────────────────────────────────────────────────────────

let activeMode: ModeConfig | null = null;
let currentCwd = process.cwd();

// ── Mode discovery ────────────────────────────────────────────────────────────

function loadModes(cwd: string): Map<string, ModeConfig> {
	const globalDir = join(getAgentDir(), "modes");
	const projectDir = join(cwd, ".pi", "modes");

	const modes = new Map<string, ModeConfig>();
	loadFromDir(globalDir, modes, "global");
	loadFromDir(projectDir, modes, "project"); // project overrides global
	return modes;
}

function loadFromDir(dir: string, modes: Map<string, ModeConfig>, source: "global" | "project"): void {
	if (!existsSync(dir)) return;
	let files: string[];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith(".md"));
	} catch {
		return;
	}
	for (const file of files) {
		const name = basename(file, ".md");
		let content: string;
		try {
			content = readFileSync(join(dir, file), "utf-8");
		} catch {
			continue;
		}
		const { frontmatter: fm, body } = parseFrontmatter<Record<string, unknown>>(content);
		const modeName = typeof fm.name === "string" ? fm.name : name;
		const appendMode = fm.append_mode === "replace" ? "replace" : "append";
		modes.set(modeName, {
			name: modeName,
			description: typeof fm.description === "string" ? fm.description : modeName,
			appendMode,
			model: typeof fm.model === "string" ? fm.model : undefined,
			systemPrompt: body.trim(),
			source,
		});
	}
}

// ── Session persistence ────────────────────────────────────────────────────────

function getModelShortName(model: string): string {
	const name = model.includes("/") ? model.split("/").pop()! : model;
	return name.replace(/-\d{8}$/, "");
}

function persistMode(pi: ExtensionAPI): void {
	if (activeMode) {
		pi.appendEntry(ENTRY_TYPE, { mode: activeMode.name, source: activeMode.source });
	} else {
		pi.appendEntry(ENTRY_TYPE, { mode: null, source: null });
	}
}

// ── Model activation ──────────────────────────────────────────────────────────

async function applyModeModel(pi: ExtensionAPI, mode: ModeConfig, ctx: ExtensionCommandContext): Promise<void> {
	if (!mode.model) return;
	const resolved = resolveModel(mode.model, ctx.modelRegistry as unknown as ModelRegistry);
	if (typeof resolved === "string") {
		// Resolution failed — resolved is an error string
		ctx.ui.notify(`Mode model not found: "${mode.model}"\n${resolved}`, "warning");
		return;
	}
	const ok = await pi.setModel(resolved);
	if (!ok) {
		ctx.ui.notify(`No API key available for model: ${mode.model}`, "warning");
	}
}

// ── Cycle logic ────────────────────────────────────────────────────────────────

async function cycleMode(pi: ExtensionAPI, ctx: any): Promise<void> {
	const modes = loadModes(currentCwd);
	const modeList = [...modes.values()];
	if (modeList.length === 0) {
		ctx.ui.notify("No modes defined. Create .md files in ~/.pi/agent/modes/", "info");
		return;
	}

	// Note: we don't wait for idle here (shortcuts should be responsive)
	// The mode change takes effect on the next agent turn

	// Find current mode index
	const current = activeMode;
	const currentIndex = current ? modeList.findIndex((m) => m.name === current.name) : -1;

	// Cycle: active mode → next mode → off (then wraps to first mode)
	if (currentIndex === -1) {
		// No mode active — activate first mode
		const first = modeList[0]!;
		activeMode = first;
		persistMode(pi);
		applyModeModel(pi, first, ctx).catch(() => {});
		ctx.ui.notify(`Mode: ${first.name}`, "info");
	} else if (currentIndex < modeList.length - 1) {
		// Cycle to next mode
		const nextMode = modeList[currentIndex + 1]!;
		activeMode = nextMode;
		persistMode(pi);
		applyModeModel(pi, nextMode, ctx).catch(() => {});
		ctx.ui.notify(`Mode: ${nextMode.name}`, "info");
	} else {
		// After last mode — turn off
		const prevName = activeMode!.name;
		activeMode = null;
		persistMode(pi);
		ctx.ui.notify(`Mode cleared (was: ${prevName})`, "info");
	}
}

// ── Extension ─────────────────────────────────────────────────────────────────

export default function agentModeExtension(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		currentCwd = ctx.cwd;
	});

	pi.on("before_agent_start", async (event) => {
		if (!activeMode) return;
		if (!activeMode.systemPrompt) return;

		if (activeMode.appendMode === "replace") {
			return { systemPrompt: activeMode.systemPrompt };
		}
		// append mode
		return {
			systemPrompt: `${event.systemPrompt}\n\n<agent_mode name="${activeMode.name}">\n${activeMode.systemPrompt}\n</agent_mode>`,
		};
	});

	// ── Keyboard shortcut: Ctrl+Shift+A ─────────────────────────────────────
	pi.registerShortcut("ctrl+shift+a", {
		description: "Cycle through agent modes",
		handler: async (ctx: any) => {
			await cycleMode(pi, ctx);
		},
	});

	pi.registerCommand("mode", {
		description: "Switch agent mode — appends a system prompt profile for this session",
		handler: async (args, ctx: ExtensionCommandContext) => {
			const trimmedArg = args.trim().toLowerCase();

			// /mode status — show current mode details
			if (trimmedArg === "status") {
				if (!activeMode) {
					ctx.ui.notify("No mode active.", "info");
				} else {
					const modelNote = activeMode.model ? `\nModel: ${activeMode.model}` : "";
					const promptPreview =
						activeMode.systemPrompt.length > 200
							? `${activeMode.systemPrompt.slice(0, 200)}…`
							: activeMode.systemPrompt;
					ctx.ui.notify(
						`Mode: ${activeMode.name} (${activeMode.source})\n${activeMode.description}` +
							`\nPrompt mode: ${activeMode.appendMode}${modelNote}\n\n${promptPreview}`,
						"info",
					);
				}
				return;
			}

			// /mode off — clear active mode
			if (trimmedArg === "off" || trimmedArg === "none" || trimmedArg === "clear") {
				if (activeMode) {
					const prev = activeMode.name;
					activeMode = null;
					persistMode(pi);
					ctx.ui.notify(`Mode cleared (was: ${prev})`, "info");
				} else {
					ctx.ui.notify("No mode is active.", "info");
				}
				return;
			}

			if (!ctx.hasUI) {
				if (activeMode) {
					ctx.ui.notify(`Active mode: ${activeMode.name}`, "info");
				} else {
					ctx.ui.notify("No mode active.", "info");
				}
				return;
			}

			await ctx.waitForIdle();

			const modes = loadModes(currentCwd);

			if (modes.size === 0) {
				ctx.ui.notify(
					`No modes found. Create .md files in:\n  ~/.pi/agent/modes/\n  ${join(currentCwd, ".pi", "modes")}/`,
					"info",
				);
				return;
			}

			// Build picker options
			const CLEAR_OPTION = "◌  No mode (clear)";
			const options: string[] = [CLEAR_OPTION];
			const modeList = [...modes.values()];
			for (const m of modeList) {
				const active = activeMode?.name === m.name ? " ✓" : "";
				const scope = m.source === "project" ? " (project)" : "";
				const modelHint = m.model ? ` · model: ${getModelShortName(m.model)}` : "";
				options.push(`${m.name}${active}  ·  ${m.description}${modelHint}${scope}`);
			}

			const choice = await ctx.ui.select(
				activeMode ? `Mode: ${activeMode.name} — change or clear` : "Select a mode",
				options,
			);
			if (!choice) return;

			if (choice === CLEAR_OPTION) {
				activeMode = null;
				persistMode(pi);
				ctx.ui.notify("Mode cleared.", "info");
				return;
			}

			// Extract mode name from choice string (before "  ·")
			const chosenName = choice.split("  ·")[0].replace(/ ✓$/, "").trim();
			const selected = modes.get(chosenName);
			if (!selected) return;

			activeMode = selected;
			persistMode(pi);

			// Apply model if specified
			await applyModeModel(pi, selected, ctx);

			const modelNote = selected.model ? `\nModel: ${selected.model}` : "";
			ctx.ui.notify(
				`Mode set: ${selected.name}\n${selected.description}` +
					`\nPrompt will be ${selected.appendMode === "replace" ? "replaced" : "appended"} on next turn.${modelNote}`,
				"info",
			);
		},
	});
}
