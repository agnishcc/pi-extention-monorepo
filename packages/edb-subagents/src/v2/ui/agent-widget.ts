import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Coordinator } from "../coordinator/coordinator.js";

export class AgentWidget {
	private timer: ReturnType<typeof setInterval> | undefined;
	private tui: any;

	constructor(
		private readonly coordinator: Coordinator,
		private readonly ui: ExtensionUIContext,
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
		this.timer = setInterval(() => this.tui?.requestRender(), 500);
		this.timer.unref?.();
	}

	private render(width: number, theme: any): string[] {
		const agents = [...this.coordinator.registry.agents.values()].filter(
			(agent) => agent.id !== "root" && agent.state !== "disposed",
		);
		if (agents.length === 0) return [];
		const count = (state: string) => agents.filter((agent) => agent.state === state).length;
		const lines = [
			truncateToWidth(
				theme.fg(
					"accent",
					`Agents ${count("running")} running · ${agents.filter((agent) => agent.state.startsWith("waiting")).length} waiting · ${count("idle")} idle`,
				),
				width,
			),
		];
		const renderChildren = (parentId: string, indent: string) => {
			const children = agents.filter((agent) => agent.parentAgentId === parentId);
			for (let index = 0; index < children.length; index++) {
				const agent = children[index]!;
				const branch = index === children.length - 1 ? "└─" : "├─";
				const run = agent.currentRunId ? this.coordinator.registry.runs.get(agent.currentRunId) : undefined;
				const task = run?.taskId ? ` task ${run.taskId}` : "";
				lines.push(
					truncateToWidth(
						`${indent}${branch} [${agent.id.slice(-6)}] ${agent.displayName.padEnd(12)} ${agent.state}${task}`,
						width,
					),
				);
				renderChildren(agent.id, `${indent}${index === children.length - 1 ? "  " : "│ "}`);
			}
		};
		renderChildren("root", "");
		return lines;
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		this.ui.setWidget("edb-subagents-v2", undefined);
		this.tui = undefined;
	}
}
