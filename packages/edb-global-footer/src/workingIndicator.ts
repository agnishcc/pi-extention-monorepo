/**
 * Working Indicator
 *
 * Displays an animated working message while the agent is processing:
 *   ✳ Reticulating... · running bash · 4s
 *
 * On completion, briefly shows a static completion verb + time taken:
 *   ✓ Crystallized · 23s
 *
 * Features:
 *   - Claude-style spinner frames (· ✢ ✳ ✶ ✻ ✽) at 150ms
 *   - Random verb from Claude's list, rotates every 2s
 *   - Per-character shimmer (accent color sweep) across the verb
 *   - Active tool suffix (e.g. "running bash", "editing file")
 *   - Elapsed timer ticking every 1s
 *   - Completion verb (past-tense) + total time, shown for 3s then cleared
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// ── Spinner frames (Claude Code style) ────────────────────────────────────────

const SPINNER_FRAMES = ["·", "✢", "✳", "✶", "✻", "✽"] as const;
const SPINNER_INTERVAL_MS = 150;

// ── Verbs ─────────────────────────────────────────────────────────────────────

const VERBS: string[] = [
	"Accomplishing",
	"Actioning",
	"Actualizing",
	"Architecting",
	"Baking",
	"Beaming",
	"Beboppin'",
	"Befuddling",
	"Billowing",
	"Blanching",
	"Bloviating",
	"Boogieing",
	"Boondoggling",
	"Booping",
	"Bootstrapping",
	"Brewing",
	"Bunning",
	"Burrowing",
	"Calculating",
	"Canoodling",
	"Caramelizing",
	"Cascading",
	"Catapulting",
	"Cerebrating",
	"Channeling",
	"Choreographing",
	"Churning",
	"Coalescing",
	"Cogitating",
	"Combobulating",
	"Composing",
	"Computing",
	"Concocting",
	"Considering",
	"Contemplating",
	"Cooking",
	"Crafting",
	"Creating",
	"Crunching",
	"Crystallizing",
	"Cultivating",
	"Deciphering",
	"Deliberating",
	"Determining",
	"Dilly-dallying",
	"Discombobulating",
	"Doing",
	"Doodling",
	"Drizzling",
	"Ebbing",
	"Elucidating",
	"Embellishing",
	"Enchanting",
	"Envisioning",
	"Fermenting",
	"Fiddle-faddling",
	"Finagling",
	"Flowing",
	"Flummoxing",
	"Forging",
	"Forming",
	"Frolicking",
	"Gallivanting",
	"Galloping",
	"Generating",
	"Gesticulating",
	"Germinating",
	"Gitifying",
	"Grooving",
	"Harmonizing",
	"Hashing",
	"Hatching",
	"Herding",
	"Hullaballooing",
	"Hyperspacing",
	"Ideating",
	"Imagining",
	"Improvising",
	"Incubating",
	"Inferring",
	"Infusing",
	"Jitterbugging",
	"Kneading",
	"Leavening",
	"Levitating",
	"Lollygagging",
	"Manifesting",
	"Marinating",
	"Meandering",
	"Metamorphosing",
	"Moonwalking",
	"Moseying",
	"Mulling",
	"Mustering",
	"Musing",
	"Nebulizing",
	"Nesting",
	"Noodling",
	"Orbiting",
	"Orchestrating",
	"Perambulating",
	"Percolating",
	"Perusing",
	"Philosophising",
	"Pollinating",
	"Pondering",
	"Pontificating",
	"Precipitating",
	"Prestidigitating",
	"Processing",
	"Propagating",
	"Puttering",
	"Puzzling",
	"Razzle-dazzling",
	"Razzmatazzing",
	"Recombobulating",
	"Reticulating",
	"Roosting",
	"Ruminating",
	"Scampering",
	"Schlepping",
	"Scurrying",
	"Seasoning",
	"Shenaniganing",
	"Shimmying",
	"Simmering",
	"Skedaddling",
	"Sketching",
	"Spelunking",
	"Spinning",
	"Sprouting",
	"Stewing",
	"Sublimating",
	"Swirling",
	"Swooping",
	"Synthesizing",
	"Tempering",
	"Thinking",
	"Tinkering",
	"Tomfoolering",
	"Transfiguring",
	"Transmuting",
	"Twisting",
	"Undulating",
	"Unfurling",
	"Unravelling",
	"Vibing",
	"Waddling",
	"Wandering",
	"Warping",
	"Whirlpooling",
	"Whirring",
	"Whisking",
	"Wibbling",
	"Working",
	"Wrangling",
	"Zesting",
	"Zigzagging",
];

const COMPLETION_VERBS: string[] = [
	"Done",
	"Complete",
	"Finished",
	"Baked",
	"Brewed",
	"Crunched",
	"Crafted",
	"Forged",
	"Generated",
	"Crystallized",
	"Transmuted",
	"Synthesized",
	"Wrangled",
	"Zigzagged",
	"Spelunked",
	"Orchestrated",
];

function randomItem<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)]!;
}

// ── Tool label config ─────────────────────────────────────────────────────────

interface ToolConfig {
	icon: string;
	labels: string[];
}

const TOOL_CONFIG: Record<string, ToolConfig> = {
	bash: {
		icon: "\uF489", //  nf-dev-terminal
		labels: ["piping dreams", "dropping to bash", "herding cats", "petting the shell", "melting faces"],
	},
	read: {
		icon: "\uF0F6", //  nf-fa-file_text_o
		labels: [
			"squinting at text",
			"hunting for clues",
			"snuggling with code",
			"cracking open files",
			"devouring content",
		],
	},
	write: {
		icon: "\uF0C7", //  nf-fa-floppy_o
		labels: [
			"birthing code",
			"crafting masterpieces",
			"channeling the muse",
			"dropping truth bombs",
			"deflowering files",
		],
	},
	edit: {
		icon: "\uF044", //  nf-fa-pencil_square_o
		labels: ["playing god", "twiddling bits", "tucking in code", "surgically altering", "violating the code"],
	},
	ls: {
		icon: "\uF07C", //  nf-fa-folder_open_o
		labels: ["peeking at files", "snooping around", "counting sheep", "creeping directories", "pillaging folders"],
	},
	find: {
		icon: "\uF422", //  nf-oct-search
		labels: [
			"tracking things down",
			"following breadcrumbs",
			"finding lost socks",
			"hunting high and low",
			"raiding the filesystem",
		],
	},
	grep: {
		icon: "\uF002", //  nf-fa-search
		labels: [
			"string hunting",
			"needle in a haystack",
			"patting for patterns",
			"pillaging with regex",
			"gutting files",
		],
	},
	// ── Task tools (shared pool) ───────────────────────────────────────────────
	TaskCreate: {
		icon: "\uF0AE", //  nf-fa-tasks
		labels: [
			"scribbling notes",
			"jotting things down",
			"dropping to-dos",
			"tagging along",
			"slinging tasks",
			"making lists",
			"brewing trouble",
			"naming a puppy",
			"spawning tasks",
			"planting seeds",
		],
	},
	TaskList: {
		icon: "\uF0AE",
		labels: [
			"making lists",
			"slinging tasks",
			"scribbling notes",
			"tagging along",
			"jotting things down",
			"dropping to-dos",
			"counting heads",
			"brewing trouble",
			"naming a puppy",
			"herding to-dos",
		],
	},
	TaskGet: {
		icon: "\uF0AE",
		labels: [
			"jotting things down",
			"tagging along",
			"scribbling notes",
			"making lists",
			"dropping to-dos",
			"slinging tasks",
			"peeking at tasks",
			"brewing trouble",
			"naming a puppy",
			"fetching the scroll",
		],
	},
	TaskUpdate: {
		icon: "\uF0AE",
		labels: [
			"dropping to-dos",
			"slinging tasks",
			"tagging along",
			"scribbling notes",
			"jotting things down",
			"making lists",
			"tweaking the plan",
			"brewing trouble",
			"naming a puppy",
			"re-scribbling",
		],
	},
	TaskOutput: {
		icon: "\uF0AE",
		labels: [
			"tagging along",
			"dropping to-dos",
			"making lists",
			"scribbling notes",
			"slinging tasks",
			"jotting things down",
			"stamping done",
			"brewing trouble",
			"naming a puppy",
			"filing the report",
		],
	},
	TaskStop: {
		icon: "\uF0AE",
		labels: [
			"brewing trouble",
			"slinging tasks",
			"dropping to-dos",
			"scribbling notes",
			"tagging along",
			"making lists",
			"pulling the plug",
			"naming a puppy",
			"jotting things down",
			"calling it quits",
		],
	},
	// ── Agent tools ───────────────────────────────────────────────────────────
	Agent: {
		icon: "\uF544", //  nf-fa5-robot
		labels: [
			"cloning myself",
			"spreading the workload",
			"making friends",
			"herding agents",
			"summoning bots",
			"pulling strings",
			"spawning minions",
			"delegating chaos",
			"multiplying",
			"outsourcing brilliance",
		],
	},
	get_subagent_result: {
		icon: "\uF544",
		labels: [
			"peeking at results",
			"pulling strings",
			"collecting the loot",
			"herding agents",
			"checking in",
			"fetching the wisdom",
			"reading the oracle",
			"gathering intel",
			"unpacking the goods",
			"seeing what happened",
		],
	},
	steer_subagent: {
		icon: "\uF544",
		labels: [
			"whispering secrets",
			"nudging along",
			"pulling strings",
			"backseat driving",
			"herding agents",
			"micromanaging",
			"sending smoke signals",
			"course correcting",
			"steering the ship",
			"poking the bot",
		],
	},
	// ── User interaction ──────────────────────────────────────────────────────
	ask_user: {
		icon: "\uF27A", //  nf-fa-comment_o
		labels: [
			"poking the human",
			"disturbing the peace",
			"breaking the flow",
			"interrogating the human",
			"cornering the user",
		],
	},
};

// Per-tool label rotation state
const toolLabelIndices = new Map<string, number>();

function getToolDisplay(toolName: string): string {
	const config = TOOL_CONFIG[toolName];
	if (!config) return `\uF489 running ${toolName}`; // fallback: terminal icon

	// Pick next label in rotation
	const idx = toolLabelIndices.get(toolName) ?? Math.floor(Math.random() * config.labels.length);
	toolLabelIndices.set(toolName, (idx + 1) % config.labels.length);

	return `${config.icon} ${config.labels[idx]}`;
}

function rotateToolLabel(toolName: string): string {
	const config = TOOL_CONFIG[toolName];
	if (!config) return `\uF489 running ${toolName}`;
	const idx = toolLabelIndices.get(toolName) ?? 0;
	toolLabelIndices.set(toolName, (idx + 1) % config.labels.length);
	return `${config.icon} ${config.labels[idx % config.labels.length]}`;
}

// ── Elapsed time formatting ────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
	const totalSeconds = Math.max(0, Math.floor(ms / 1000));
	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const minutes = totalMinutes % 60;
	const hours = Math.floor(totalMinutes / 60);

	if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
	if (totalMinutes > 0) return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;
	return `${seconds}s`;
}

// ── Shimmer ───────────────────────────────────────────────────────────────────

const SHIMMER_BAND_WIDTH = 4;

function hexToRgb(hex: string): [number, number, number] {
	const h = hex.replace("#", "");
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function blendColors(c1: [number, number, number], c2: [number, number, number], t: number): [number, number, number] {
	return [
		Math.round(c1[0] + (c2[0] - c1[0]) * t),
		Math.round(c1[1] + (c2[1] - c1[1]) * t),
		Math.round(c1[2] + (c2[2] - c1[2]) * t),
	];
}

function lightenRgb(r: number, g: number, b: number, amount: number): [number, number, number] {
	return [
		Math.min(255, Math.round(r + (255 - r) * amount)),
		Math.min(255, Math.round(g + (255 - g) * amount)),
		Math.min(255, Math.round(b + (255 - b) * amount)),
	];
}

function getAccentHex(ctx: ExtensionContext): string | null {
	const sample = ctx.ui.theme.fg("accent", "\u2588");
	const match = sample.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
	if (!match) return null;
	const r = parseInt(match[1]!, 10).toString(16).padStart(2, "0");
	const g = parseInt(match[2]!, 10).toString(16).padStart(2, "0");
	const b = parseInt(match[3]!, 10).toString(16).padStart(2, "0");
	return `#${r}${g}${b}`;
}

function applyShimmer(text: string, frame: number, baseHex: string, shimmerHex: string): string {
	const base = hexToRgb(baseHex);
	const shimmer = hexToRgb(shimmerHex);
	const totalWidth = text.length + SHIMMER_BAND_WIDTH * 2;
	const pos = frame % totalWidth;

	let result = "";
	for (let i = 0; i < text.length; i++) {
		const dist = Math.abs(i - pos);
		const t = Math.max(0, 1 - dist / SHIMMER_BAND_WIDTH);
		const color = blendColors(base, shimmer, t);
		result += `\x1b[38;2;${color[0]};${color[1]};${color[2]}m${text[i]}\x1b[0m`;
	}
	return result;
}

export interface WorkingIndicatorRef {
	currentLine: string | undefined;
}

// ── Working Indicator ─────────────────────────────────────────────────────────

export function installWorkingIndicator(pi: ExtensionAPI): WorkingIndicatorRef {
	const ref: WorkingIndicatorRef = { currentLine: undefined };
	let ctx: ExtensionContext | null = null;
	let isActive = false;

	// Timers
	let spinnerTimer: ReturnType<typeof setInterval> | null = null;
	let verbTimer: ReturnType<typeof setInterval> | null = null;
	let tickTimer: ReturnType<typeof setInterval> | null = null;
	let completionTimer: ReturnType<typeof setTimeout> | null = null;

	// State
	let shimmerFrame = 0;
	let currentVerb = "Working";
	let startedAt = 0;
	let elapsedMs = 0;
	let toolSuffix: string | undefined;
	const activeTools = new Map<string, string>(); // toolCallId -> toolName
	let toolLabelTimer: ReturnType<typeof setInterval> | null = null;

	// Shimmer colors (resolved once per session from theme)
	let accentHex: string | null = null;
	let shimmerHex: string | null = null;

	// ── Color resolution ──────────────────────────────────────────────────────

	function resolveColors(): void {
		if (!ctx) return;
		accentHex = getAccentHex(ctx);
		if (accentHex) {
			const [r, g, b] = hexToRgb(accentHex);
			const [lr, lg, lb] = lightenRgb(r, g, b, 0.55);
			shimmerHex = `#${lr.toString(16).padStart(2, "0")}${lg.toString(16).padStart(2, "0")}${lb.toString(16).padStart(2, "0")}`;
		}
	}

	// ── Render ────────────────────────────────────────────────────────────────

	function render(): void {
		if (!ctx || !isActive) return;

		const theme = ctx.ui.theme;
		const sep = theme.fg("dim", " · ");

		// Verb with shimmer
		const verbText = `${currentVerb}...`;
		let verbStyled: string;
		if (accentHex && shimmerHex) {
			verbStyled = applyShimmer(verbText, shimmerFrame, accentHex, shimmerHex);
		} else {
			verbStyled = theme.fg("accent", verbText);
		}

		// Timer
		const timer = theme.fg("dim", formatElapsed(elapsedMs));

		// Assemble parts — do NOT include frame here; the Loader prepends its own spinner via setWorkingIndicator
		const parts: string[] = [verbStyled];
		if (toolSuffix) parts.push(theme.fg("dim", toolSuffix));
		parts.push(timer);

		const rendered = parts.join(sep);
		ref.currentLine = rendered;
		ctx.ui.setWorkingMessage(rendered);
	}

	// ── Timer management ──────────────────────────────────────────────────────

	function startTimers(): void {
		// Shimmer: 150ms
		spinnerTimer = setInterval(() => {
			shimmerFrame++;
			render();
		}, SPINNER_INTERVAL_MS);

		// Verb rotation: 2s
		verbTimer = setInterval(() => {
			currentVerb = randomItem(VERBS);
			render();
		}, 2000);

		// Elapsed tick: 1s
		tickTimer = setInterval(() => {
			elapsedMs = Date.now() - startedAt;
			render();
		}, 1000);
	}

	function stopTimers(): void {
		if (spinnerTimer) {
			clearInterval(spinnerTimer);
			spinnerTimer = null;
		}
		if (verbTimer) {
			clearInterval(verbTimer);
			verbTimer = null;
		}
		if (tickTimer) {
			clearInterval(tickTimer);
			tickTimer = null;
		}
		if (toolLabelTimer) {
			clearInterval(toolLabelTimer);
			toolLabelTimer = null;
		}
	}

	function cancelCompletionTimer(): void {
		if (completionTimer) {
			clearTimeout(completionTimer);
			completionTimer = null;
			ctx?.ui.setWidget("wi-completion", undefined);
		}
	}

	// ── Completion ────────────────────────────────────────────────────────────

	function showCompletion(totalMs: number): void {
		if (!ctx) return;
		cancelCompletionTimer();

		const theme = ctx.ui.theme;
		const check = theme.fg("success", "✓");
		const verb = theme.fg("accent", randomItem(COMPLETION_VERBS));
		const time = theme.fg("dim", formatElapsed(totalMs));
		const sep = theme.fg("dim", " · ");
		const completionLine = `${check}${sep}${verb}${sep}${time}`;

		// The Loader is torn down by pi on agent_end, so setWorkingMessage is a no-op.
		// Use setWidget to briefly show the completion state above the editor.
		ctx.ui.setWidget("wi-completion", [completionLine]);

		completionTimer = setTimeout(() => {
			completionTimer = null;
			ref.currentLine = undefined;
			ctx?.ui.setWidget("wi-completion", undefined);
		}, 3000);
	}

	// ── Spinner frames (apply to pi's working indicator widget) ───────────────

	function applySpinnerFrames(): void {
		if (!ctx) return;
		const colored = SPINNER_FRAMES.map((f) => ctx!.ui.theme.fg("accent", f));
		ctx.ui.setWorkingIndicator({ frames: colored, intervalMs: SPINNER_INTERVAL_MS });
	}

	// ── Event hooks ───────────────────────────────────────────────────────────

	pi.on("session_start", async (_event, sessionCtx) => {
		ctx = sessionCtx;
		resolveColors();
		applySpinnerFrames();
	});

	pi.on("agent_start", async (_event, agentCtx) => {
		ctx = agentCtx;
		cancelCompletionTimer();
		stopTimers();

		isActive = true;
		startedAt = Date.now();
		elapsedMs = 0;
		shimmerFrame = 0;
		toolSuffix = undefined;
		activeTools.clear();
		toolLabelIndices.clear();
		currentVerb = randomItem(VERBS);

		resolveColors();
		applySpinnerFrames();
		render();
		startTimers();
	});

	pi.on("tool_execution_start", (event) => {
		if (!isActive) return;
		const e = event as { toolCallId?: string; toolName?: string };
		if (e.toolCallId && e.toolName) {
			activeTools.set(e.toolCallId, e.toolName); // store tool name, not display string
			toolSuffix = getToolDisplay(e.toolName);

			// Start rotating the label for this tool every 2s
			if (toolLabelTimer) {
				clearInterval(toolLabelTimer);
				toolLabelTimer = null;
			}
			const _activeName = e.toolName;
			toolLabelTimer = setInterval(() => {
				// Only rotate if this tool is still active
				const currentToolName = Array.from(activeTools.values()).at(-1);
				if (currentToolName) {
					toolSuffix = rotateToolLabel(currentToolName);
					render();
				}
			}, 2000);

			render();
		}
	});

	pi.on("tool_execution_end", (event) => {
		if (!isActive) return;
		const e = event as { toolCallId?: string };
		if (e.toolCallId) activeTools.delete(e.toolCallId);
		const remainingTool = Array.from(activeTools.values()).at(-1);
		if (remainingTool) {
			toolSuffix = getToolDisplay(remainingTool);
		} else {
			toolSuffix = undefined;
			if (toolLabelTimer) {
				clearInterval(toolLabelTimer);
				toolLabelTimer = null;
			}
		}
		render();
	});

	pi.on("agent_end", async (_event, agentCtx) => {
		ctx = agentCtx;
		const totalMs = startedAt > 0 ? Date.now() - startedAt : 0;

		stopTimers();
		isActive = false;
		toolSuffix = undefined;
		activeTools.clear();

		showCompletion(totalMs);
	});

	pi.on("session_shutdown", async () => {
		stopTimers();
		cancelCompletionTimer();
		isActive = false;
		ref.currentLine = undefined;
		ctx = null;
	});

	return ref;
}
