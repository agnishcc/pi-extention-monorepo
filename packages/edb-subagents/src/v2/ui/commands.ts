import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Coordinator } from "../coordinator/coordinator.js";

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
			const [command = "tree", id] = args.trim().split(/\s+/);
			if (command === "tree" || command === "") ctx.ui.notify(tree(coordinator), "info");
			else if (command === "questions") {
				const questions = coordinator.listQuestions();
				ctx.ui.notify(
					questions.length
						? questions.map((question) => `${question.id} [${question.state}] ${question.text}`).join("\n")
						: "No questions",
					"info",
				);
			} else if (command === "show" && id) {
				const agent = coordinator.registry.getAgent(id);
				ctx.ui.notify(JSON.stringify(agent, null, 2), "info");
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
					"Usage: /agents [tree|questions|show <id>|stop <id>|dispose <id>|recovery|outbox|diagnostics]",
					"warning",
				);
			}
		},
	});
}
