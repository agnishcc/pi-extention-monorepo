import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Coordinator } from "../coordinator/coordinator.js";
import type { ActivityBoard, LiveActivity } from "../runtime/activity.js";
import type { RunRecord } from "../types.js";

/** Claude Code–style spinner frames for animated running indicator. */
const SPINNER = ["·", "✢", "✳", "✶", "✻", "✽"];

/** Widget repaint interval — drives the spinner and elapsed timers. */
const REFRESH_MS = 250;

/** How long a finished (idle) agent stays visible before dropping off the widget. */
const FINISHED_LINGER_MS = 30_000;

function formatMs(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Tool name → human-readable action for the steps line. */
const TOOL_DISPLAY: Record<string, string> = {
	read: "reading",
	bash: "running command",
	edit: "editing",
	write: "writing",
	grep: "searching",
	find: "finding files",
	ls: "listing",
};

/** Compact token count: "1.2k token" / "3.4M token". */
function formatTokens(count: number): string {
	if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M token`;
	if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k token`;
	return `${count} token`;
}

/** Build the human-readable steps line for a live agent (V1's describeActivity). */
function describeActivity(entry: LiveActivity): string {
	if (entry.tools.size > 0) {
		const actions = [...entry.tools].map((tool) => TOOL_DISPLAY[tool] ?? tool);
		return `${actions.join(", ")}…`;
	}
	const line =
		entry.text
			.split("\n")
			.find((candidate) => candidate.trim())
			?.trim() ?? "";
	if (line.length > 0) return line.length > 60 ? `${line.slice(0, 60)}…` : line;
	return "thinking…";
}

export class AgentWidget {
	private timer: ReturnType<typeof setInterval> | undefined;
	private tui: any;
	private frame = 0;
	/** Agent id → when it became idle (and the duration of its last run), for finished-agent aging. */
	private finishedAt = new Map<string, { at: number; durationMs: number }>();

	constructor(
		private readonly coordinator: Coordinator,
		private readonly ui: ExtensionUIContext,
		private readonly activity?: ActivityBoard,
	) {}

	start(): void {
		this.ui.setWidget(
			"edb-subagents-v2",
			(tui, theme) => {
				this.tui = tui;
				return {
					render: (width: number) => this.render(width, theme),
					invalidate: () => {},
				};
			},
			{ placement: "aboveEditor" },
		);
		this.timer = setInterval(() => {
			this.frame++;
			this.tui?.requestRender();
		}, REFRESH_MS);
		this.timer.unref?.();
	}

	private latestRun(agentId: string): RunRecord | undefined {
		let latest: RunRecord | undefined;
		for (const run of this.coordinator.registry.runs.values()) {
			if (run.agentId !== agentId) continue;
			if (!latest || (run.completedAt ?? run.createdAt) > (latest.completedAt ?? latest.createdAt)) latest = run;
		}
		return latest;
	}

	private render(width: number, theme: any): string[] {
		const now = Date.now();
		const agents = [...this.coordinator.registry.agents.values()].filter(
			(agent) => agent.id !== "root" && agent.state !== "disposed",
		);
		if (agents.length === 0) return [];

		// Prune bookkeeping for agents that left the registry.
		for (const [id] of this.finishedAt) {
			if (!agents.some((agent) => agent.id === id)) this.finishedAt.delete(id);
		}

		// Age out finished (idle) agents after a short linger; keep everything else visible.
		const visible = agents.filter((agent) => {
			if (agent.state !== "idle") {
				this.finishedAt.delete(agent.id);
				return true;
			}
			if (!this.finishedAt.has(agent.id)) {
				const lastRun = this.latestRun(agent.id);
				const durationMs =
					lastRun?.startedAt && lastRun.completedAt
						? Date.parse(lastRun.completedAt) - Date.parse(lastRun.startedAt)
						: 0;
				this.finishedAt.set(agent.id, { at: now, durationMs });
			}
			return now - (this.finishedAt.get(agent.id)?.at ?? now) < FINISHED_LINGER_MS;
		});
		if (visible.length === 0) return [];

		const running = visible.filter((agent) => agent.state === "running");
		const waiting = visible.filter((agent) => agent.state.startsWith("waiting"));
		const finished = visible.length - running.length - waiting.length;
		const frame = SPINNER[this.frame % SPINNER.length];

		const truncate = (line: string) => truncateToWidth(line, width);
		const lines = [
			truncate(
				theme.fg("accent", `● Agents ${running.length} running · ${waiting.length} waiting · ${finished} finished`),
			),
		];

		const renderChildren = (parentId: string, indent: string) => {
			const children = visible.filter((agent) => agent.parentAgentId === parentId);
			for (let index = 0; index < children.length; index++) {
				const agent = children[index]!;
				const isLast = index === children.length - 1;
				const branch = isLast ? "└─" : "├─";
				const run = agent.currentRunId ? this.coordinator.registry.runs.get(agent.currentRunId) : undefined;
				const task = run?.taskId ? ` task ${run.taskId}` : "";
				const name = agent.displayName.padEnd(12);
				const prefix = `${indent}${branch} `;
				lines.push(truncate(`${prefix}${this.statusLine(agent, run, frame, theme, name, task, now)}`));
				// Steps line — the live activity of running agents (which tool, latest text).
				const entry = this.activity?.byAgent.get(agent.id);
				if (agent.state === "running" && entry) {
					const activityIndent = `${indent}${isLast ? "  " : "│ "}  `;
					lines.push(truncate(`${activityIndent}${theme.fg("dim", `⎿  ${describeActivity(entry)}`)}`));
				}
				renderChildren(agent.id, `${indent}${isLast ? "  " : "│ "}`);
			}
		};
		renderChildren("root", "");
		return lines;
	}

	private statusLine(
		agent: { id: string; state: string; displayName: string; maxTurns?: number },
		run: RunRecord | undefined,
		frame: string,
		theme: any,
		name: string,
		task: string,
		now: number,
	): string {
		const state = agent.state;
		const elapsed = run?.startedAt ? formatMs(now - Date.parse(run.startedAt)) : undefined;
		const entry = this.activity?.byAgent.get(agent.id);
		const stats: string[] = [];
		if (entry && entry.turns > 0) stats.push(`⟳${entry.turns}${agent.maxTurns ? `≤${agent.maxTurns}` : ""}`);
		if (entry && entry.toolUses > 0) stats.push(`${entry.toolUses} tool use${entry.toolUses === 1 ? "" : "s"}`);
		if (entry && entry.tokens > 0) stats.push(formatTokens(entry.tokens));
		if (elapsed) stats.push(elapsed);
		const statsText = stats.length > 0 ? ` · ${stats.join(" · ")}` : "";
		if (state === "running") {
			return `${theme.fg("accent", frame)} ${name}${theme.fg("accent", " running")}${statsText}${task}`;
		}
		if (state.startsWith("waiting")) {
			return `${theme.fg("warning", "⏸")} ${name}${theme.fg("warning", " waiting")}${statsText}${task}`;
		}
		if (state === "queued") {
			return `${theme.fg("muted", "◦")} ${name}${theme.fg("dim", " queued")}${task}`;
		}
		if (state === "stopping") {
			return `${theme.fg("dim", "■")} ${name}${theme.fg("dim", " stopping")}${statsText}${task}`;
		}
		if (state === "error") {
			return `${theme.fg("error", "✗")} ${name}${theme.fg("error", " error")}${task}`;
		}
		if (state === "idle") {
			const duration = this.finishedAt.get(agent.id);
			const durationText = duration && duration.durationMs > 0 ? ` · ${formatMs(duration.durationMs)}` : "";
			return `${theme.fg("success", "✓")} ${name}${theme.fg("dim", " completed")}${durationText}${task}`;
		}
		return `${theme.fg("dim", "○")} ${name}${theme.fg("dim", ` ${state}`)}${task}`;
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		this.finishedAt.clear();
		this.ui.setWidget("edb-subagents-v2", undefined);
		this.tui = undefined;
	}
}
