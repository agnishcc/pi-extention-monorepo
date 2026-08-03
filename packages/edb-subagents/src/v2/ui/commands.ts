import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Coordinator } from "../coordinator/coordinator.js";
import type { AgentRecord, RunState } from "../types.js";

const RUNNING_ICON = "✳";
const WAITING_ICON = "⏸";
const DONE_ICON = "✓";
const IDLE_ICON = "◦";
const ERROR_ICON = "✗";
const RETIRED_ICON = "·";

const TERMINAL_RUN_STATES: ReadonlySet<RunState> = new Set([
	"completed",
	"failed",
	"cancelled",
	"timed_out",
	"interrupted",
]);

interface AgentGroups {
	running: AgentRecord[];
	waiting: AgentRecord[];
	done: AgentRecord[];
	idle: AgentRecord[];
	error: AgentRecord[];
	retired: AgentRecord[];
}

function groupAgents(coordinator: Coordinator): AgentGroups {
	const groups: AgentGroups = { running: [], waiting: [], done: [], idle: [], error: [], retired: [] };
	for (const agent of coordinator.registry.agents.values()) {
		switch (agent.state) {
			case "running":
			case "queued":
			case "stopping":
				groups.running.push(agent);
				break;
			case "waiting_parent":
			case "waiting_child":
				groups.waiting.push(agent);
				break;
			case "error":
				groups.error.push(agent);
				break;
			case "disposed":
				groups.retired.push(agent);
				break;
			case "idle": {
				const hasTerminalRun = [...coordinator.registry.runs.values()].some(
					(run) => run.agentId === agent.id && TERMINAL_RUN_STATES.has(run.state),
				);
				(hasTerminalRun ? groups.done : groups.idle).push(agent);
				break;
			}
			default:
				groups.idle.push(agent);
		}
	}
	return groups;
}

function currentPrompt(coordinator: Coordinator, agent: AgentRecord): string {
	if (!agent.currentRunId) return "";
	const run = coordinator.registry.runs.get(agent.currentRunId);
	const prompt = run?.prompt ?? "";
	return prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;
}

function agentLine(coordinator: Coordinator, icon: string, agent: AgentRecord): string {
	const prompt =
		agent.state === "idle" || agent.state === "disposed" ? "" : ` — "${currentPrompt(coordinator, agent)}"`;
	return `${icon} ${agent.displayName} (${agent.type}) [${agent.state}]${prompt}`;
}

function renderGroupedList(coordinator: Coordinator): string {
	const groups = groupAgents(coordinator);
	const lines: string[] = [];
	const append = (title: string, items: AgentRecord[], icon: string) => {
		if (items.length === 0) return;
		lines.push(`\n${title} — ${items.length}`);
		for (const agent of items) lines.push(agentLine(coordinator, icon, agent));
	};
	append("✳ Running", groups.running, RUNNING_ICON);
	append("⏸ Waiting", groups.waiting, WAITING_ICON);
	append("✓ Done", groups.done, DONE_ICON);
	append("◦ Idle", groups.idle, IDLE_ICON);
	append("✗ Error", groups.error, ERROR_ICON);
	append("· Retired", groups.retired, RETIRED_ICON);
	return lines.join("\n").trim() || "No agents yet";
}

function statusSummary(coordinator: Coordinator): string {
	const groups = groupAgents(coordinator);
	return `${groups.running.length} running · ${groups.waiting.length} waiting · ${groups.done.length} done · ${groups.idle.length} idle`;
}

function sessionFor(agent: AgentRecord): string | null {
	return agent.sessionFile;
}

function safeWindowName(name: string): string {
	const cleaned = name
		.replace(/[^a-zA-Z0-9._-]/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	return `sub-${cleaned.slice(0, 20) || "agent"}`;
}

/**
 * Open a tmux popup (display-popup) running the given shell command.
 * Uses the pi binary next to the running node executable so the popup
 * finds `pi` regardless of the tmux server's PATH. With -E the popup
 * closes automatically when the command exits.
 */
function openTmuxPopup(ctx: ExtensionCommandContext, title: string, command: string): void {
	if (!process.env.TMUX) {
		ctx.ui.notify("Not inside tmux — cannot open a popup", "warning");
		return;
	}
	const proc = spawn("tmux", ["display-popup", "-E", "-T", title, "-w", "90%", "-h", "90%", command], {
		detached: true,
		stdio: "ignore",
	});
	proc.on("error", (err) => ctx.ui.notify(`tmux popup failed: ${err.message}`, "warning"));
	proc.unref();
}

function piBin(): string {
	return join(dirname(process.execPath), "pi");
}

function openAgentSession(ctx: ExtensionCommandContext, agent: AgentRecord): void {
	const sessionFile = sessionFor(agent);
	if (!sessionFile) {
		ctx.ui.notify(`${agent.displayName} has no session file yet`, "warning");
		return;
	}
	const title = safeWindowName(agent.displayName);
	// Invoke node by absolute path: the tmux popup inherits the server's PATH,
	// which lacks the nvm bin dir — `#!/usr/bin/env node` shebangs fail there.
	const command = `'${process.execPath}' '${piBin()}' --session '${sessionFile}'`;
	openTmuxPopup(ctx, title, command);
	ctx.ui.notify(`Opened ${agent.displayName} in tmux popup (${sessionFile})`, "info");
}

function tailAgentSession(ctx: ExtensionCommandContext, agent: AgentRecord): void {
	const sessionFile = sessionFor(agent);
	if (!sessionFile) {
		ctx.ui.notify(`${agent.displayName} has no session file yet`, "warning");
		return;
	}
	const title = `tail-${safeWindowName(agent.displayName).slice(4)}`;
	const command = `tail -n 100 -f '${sessionFile}'`;
	openTmuxPopup(ctx, title, command);
	ctx.ui.notify(`Tailing ${agent.displayName} in tmux popup "${title}"`, "info");
}

async function showAgentList(ctx: ExtensionCommandContext, coordinator: Coordinator): Promise<AgentRecord | undefined> {
	const groups = groupAgents(coordinator);
	const all = [
		...groups.running,
		...groups.waiting,
		...groups.done,
		...groups.idle,
		...groups.error,
		...groups.retired,
	];
	if (all.length === 0) return undefined;
	const icons: Record<keyof AgentGroups, string> = {
		running: RUNNING_ICON,
		waiting: WAITING_ICON,
		done: DONE_ICON,
		idle: IDLE_ICON,
		error: ERROR_ICON,
		retired: RETIRED_ICON,
	};
	const order: (keyof AgentGroups)[] = ["running", "waiting", "done", "idle", "error", "retired"];
	const choices: string[] = [];
	for (const key of order) {
		for (const agent of groups[key]) choices.push(agentLine(coordinator, icons[key], agent));
	}
	choices.push("← Back");
	const selected = await ctx.ui.select("Agents", choices);
	if (!selected || selected === "← Back") return undefined;
	const index = choices.indexOf(selected);
	return index >= 0 && index < all.length ? all[index] : undefined;
}

function agentDetailTitle(coordinator: Coordinator, agent: AgentRecord): string {
	const runs = [...coordinator.registry.runs.values()].filter((run) => run.agentId === agent.id);
	const last = runs.length > 0 ? runs[runs.length - 1] : undefined;
	const lines = [
		`${agent.id} — ${agent.displayName} (${agent.type})`,
		`state: ${agent.state} · model: ${agent.model ?? "default"} · toolProfile: ${agent.toolProfile}`,
		`runs: ${runs.length}${last ? ` (last: ${last.state})` : ""} · created: ${agent.createdAt.slice(0, 16)}`,
	];
	if (agent.currentRunId) {
		const run = coordinator.registry.runs.get(agent.currentRunId);
		if (run) lines.push(`current: ${run.state} — "${run.prompt.slice(0, 80)}"`);
	}
	if (agent.sessionFile) lines.push(`session: ${agent.sessionFile}`);
	return lines.join("\n");
}

async function showAgentDetail(
	ctx: ExtensionCommandContext,
	coordinator: Coordinator,
	agent: AgentRecord,
): Promise<void> {
	const active =
		agent.state === "running" ||
		agent.state === "queued" ||
		agent.state === "stopping" ||
		agent.state === "waiting_parent" ||
		agent.state === "waiting_child";
	const actions: string[] = [];
	if (agent.sessionFile) actions.push("▸ Open session in tmux");
	if (active) actions.push("◉ Live tail");
	if (active) actions.push("■ Stop");
	actions.push("✗ Dispose");
	actions.push("ℹ Show record");
	actions.push("← Back");
	const action = await ctx.ui.select(agentDetailTitle(coordinator, agent), actions);
	if (action === "▸ Open session in tmux") openAgentSession(ctx, agent);
	else if (action === "◉ Live tail") tailAgentSession(ctx, agent);
	else if (action === "■ Stop") {
		await coordinator.stop(coordinator.caller("root", new AbortController().signal), agent.id);
		ctx.ui.notify(`Stopped ${agent.id}`, "info");
	} else if (action === "✗ Dispose") {
		await coordinator.disposeAgent(coordinator.caller("root", new AbortController().signal), agent.id);
		ctx.ui.notify(`Disposed ${agent.id}`, "info");
	} else if (action === "ℹ Show record") {
		ctx.ui.notify(JSON.stringify(agent, null, 2), "info");
	} else {
		return;
	}
	await showAgentList(ctx, coordinator);
}

async function showMenu(ctx: ExtensionCommandContext, coordinator: Coordinator): Promise<void> {
	const groups = groupAgents(coordinator);
	if (coordinator.registry.agents.size === 0) {
		ctx.ui.notify("No agents yet — spawn one with the Agent tool.", "info");
		return;
	}
	const canOpen = [...coordinator.registry.agents.values()].some((agent) => agent.sessionFile);
	while (true) {
		const options: string[] = [
			`List agents (${statusSummary(coordinator)})`,
			...(canOpen ? ["Open agent session in tmux"] : []),
			...(groups.running.length > 0 ? ["Live tail a running agent"] : []),
			...(groups.waiting.length > 0 ? [`Questions (${groups.waiting.length})`] : []),
			"Recovery",
			"Outbox",
			"Diagnostics",
		];
		const choice = await ctx.ui.select("Subagents", options);
		if (!choice) return;
		if (choice.startsWith("List agents")) {
			const agent = await showAgentList(ctx, coordinator);
			if (agent) await showAgentDetail(ctx, coordinator, agent);
		} else if (choice === "Open agent session in tmux") {
			const agent = await showAgentList(ctx, coordinator);
			if (agent) openAgentSession(ctx, agent);
		} else if (choice === "Live tail a running agent") {
			const agent = await showAgentList(ctx, coordinator);
			if (agent) tailAgentSession(ctx, agent);
		} else if (choice.startsWith("Questions")) {
			ctx.ui.notify(
				coordinator.listQuestions().length
					? coordinator
							.listQuestions()
							.map((question) => `${question.id} [${question.state}] ${question.text}`)
							.join("\n")
					: "No questions",
				"info",
			);
		} else if (choice === "Recovery") {
			ctx.ui.notify(JSON.stringify(coordinator.recoverySummary, null, 2), "info");
		} else if (choice === "Outbox") {
			ctx.ui.notify(JSON.stringify(coordinator.listOutbox(), null, 2), "info");
		} else if (choice === "Diagnostics") {
			ctx.ui.notify(JSON.stringify(coordinator.listDiagnostics(), null, 2), "info");
		}
	}
}

function tree(coordinator: Coordinator): string {
	const lines: string[] = ["root"];
	const walk = (parentId: string, indent: string) => {
		const children = coordinator.registry.children(parentId);
		children.forEach((agent, index) => {
			const last = index === children.length - 1;
			lines.push(`${indent}${last ? "└─" : "├─"} ${agent.id} ${agent.displayName} [${agent.state}]`);
			walk(agent.id, `${indent}${last ? "   " : "│  "}`);
		});
	};
	walk("root", "");
	return lines.join("\n");
}

export function registerCommands(pi: ExtensionAPI, getCoordinator: () => Coordinator | undefined): void {
	pi.registerCommand("agents", {
		description: "Inspect and manage the V2 agent tree",
		handler: async (args, ctx: ExtensionCommandContext) => {
			const coordinator = getCoordinator();
			if (!coordinator) {
				ctx.ui.notify("Subagents V2 is not started", "warning");
				return;
			}
			const [command = "menu", id] = (args.trim() || "menu").split(/\s+/);
			if (command === "menu") await showMenu(ctx, coordinator);
			else if (command === "tree") ctx.ui.notify(tree(coordinator), "info");
			else if (command === "list") ctx.ui.notify(renderGroupedList(coordinator), "info");
			else if (command === "open" && id) {
				try {
					openAgentSession(ctx, coordinator.registry.getAgent(id));
				} catch (err) {
					ctx.ui.notify(err instanceof Error ? err.message : String(err), "warning");
				}
			} else if (command === "tail" && id) {
				try {
					tailAgentSession(ctx, coordinator.registry.getAgent(id));
				} catch (err) {
					ctx.ui.notify(err instanceof Error ? err.message : String(err), "warning");
				}
			} else if (command === "questions") {
				const questions = coordinator.listQuestions();
				ctx.ui.notify(
					questions.length
						? questions.map((question) => `${question.id} [${question.state}] ${question.text}`).join("\n")
						: "No questions",
					"info",
				);
			} else if (command === "show" && id) {
				ctx.ui.notify(JSON.stringify(coordinator.registry.getAgent(id), null, 2), "info");
			} else if (command === "stop" && id) {
				await coordinator.stop(coordinator.caller("root", new AbortController().signal), id);
				ctx.ui.notify(`Stopped ${id}`, "info");
			} else if (command === "dispose" && id) {
				await coordinator.disposeAgent(coordinator.caller("root", new AbortController().signal), id);
				ctx.ui.notify(`Disposed ${id}`, "info");
			} else if (command === "recovery") {
				ctx.ui.notify(JSON.stringify(coordinator.recoverySummary, null, 2), "info");
			} else if (command === "outbox") {
				ctx.ui.notify(JSON.stringify(coordinator.listOutbox(), null, 2), "info");
			} else if (command === "diagnostics") {
				ctx.ui.notify(JSON.stringify(coordinator.listDiagnostics(), null, 2), "info");
			} else {
				ctx.ui.notify(
					"Usage: /agents [menu|list|tree|questions|show <id>|open <id>|tail <id>|stop <id>|dispose <id>|recovery|outbox|diagnostics]",
					"warning",
				);
			}
		},
	});
}
