import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { AgentRegistry } from "./coordinator/agent-registry.js";
import { Coordinator } from "./coordinator/coordinator.js";
import { DiagnosticLog } from "./diagnostics/diagnostic-log.js";
import { TodoClient } from "./integrations/todo-client.js";
import { AtomicStore } from "./persistence/atomic-store.js";
import { HumanAdapter } from "./questions/human-adapter.js";
import { QuestionService } from "./questions/question-service.js";
import { ActivityBoard } from "./runtime/activity.js";
import { loadV2AgentDefinitions } from "./runtime/agent-definitions.js";
import { ChildRuntime } from "./runtime/child-adapter.js";
import { RootAdapter } from "./runtime/root-adapter.js";
import { RuntimePool } from "./runtime/runtime-pool.js";
import { SessionFactory } from "./runtime/session-factory.js";
import { loadV2Settings } from "./settings.js";
import { AgentWidget } from "./ui/agent-widget.js";
import { registerCommands } from "./ui/commands.js";
import { renderV2Notification, type V2NotificationDetails } from "./ui/notification-renderer.js";

export default function subagentsV2Extension(pi: ExtensionAPI): void {
	// Custom TUI renderer for sub-agent completion notifications (mirrors V1's subagent-notification).
	pi.registerMessageRenderer<V2NotificationDetails>("edb-subagents-v2", (message, { expanded }, theme) => {
		const d = message.details;
		if (!d) return undefined;
		return renderV2Notification(d, expanded, theme);
	});

	let coordinator: Coordinator | undefined;
	let widget: AgentWidget | undefined;
	let humanAdapter: HumanAdapter | undefined;
	let shuttingDown: Promise<void> | undefined;
	let rootTaskToolsRegistered = false;
	const registerRootTaskTools = () => {
		if (!coordinator || rootTaskToolsRegistered || !coordinator.todoAvailable) return;
		for (const tool of coordinator.createTaskProxyTools("root")) pi.registerTool(tool);
		rootTaskToolsRegistered = true;
	};

	registerCommands(pi, () => coordinator);

	pi.on("before_agent_start", async (_event, ctx) => {
		humanAdapter?.setContext(ctx);
	});

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		if (coordinator) await coordinator.shutdown("session_shutdown");
		widget?.dispose();
		rootTaskToolsRegistered = false;
		const settings = loadV2Settings(ctx.cwd);
		const rootSessionId = ctx.sessionManager.getSessionId();
		const safeRootSessionId = rootSessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
		const stateDirectory = join(getAgentDir(), "subagents", safeRootSessionId);
		const definitions = loadV2AgentDefinitions(
			ctx.cwd,
			settings.projectAgents === "trusted" && ctx.isProjectTrusted(),
		);
		const todoClient = new TodoClient(pi, 1_000, registerRootTaskTools);
		todoClient.start(rootSessionId);
		const rootModelStr = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown";
		humanAdapter = new HumanAdapter();
		humanAdapter.setContext(ctx);
		const questions = new QuestionService(new AgentRegistry());
		let coordinatorReference!: Coordinator;
		const activityBoard = new ActivityBoard();
		const sessionFactory = new SessionFactory({
			sessionsDirectory: join(stateDirectory, "sessions"),
			rootModel: ctx.model,
			modelRegistry: ctx.modelRegistry,
			createTools: (agent, control, abort) => coordinatorReference.createAgentTools(agent.id, control, abort),
			resolveDefinition: (agent) => definitions.get(agent.type),
		});
		const runtimePool = new RuntimePool(
			() => new ChildRuntime(sessionFactory, activityBoard),
			settings.idleRuntimeEvictionMs,
		);
		coordinator = new Coordinator({
			rootSessionId,
			cwd: ctx.cwd,
			settings,
			store: new AtomicStore(stateDirectory, rootSessionId, ctx.cwd),
			runtimePool,
			rootAdapter: new RootAdapter(pi),
			todoClient,
			questions,
			humanAdapter,
			diagnostics: new DiagnosticLog(join(stateDirectory, "diagnostics"), rootSessionId),
			rootModel: rootModelStr,
			emitUsage: (payload) => pi.events.emit("subagents:usage", payload),
			agentDefinitions: definitions,
		});
		coordinatorReference = coordinator;
		await coordinator.start();
		const registeredTaskNames = new Set(
			rootTaskToolsRegistered ? coordinator.createTaskProxyTools("root").map((tool) => tool.name) : [],
		);
		for (const tool of coordinator.createAgentTools("root")) {
			if (!registeredTaskNames.has(tool.name)) pi.registerTool(tool);
		}
		rootTaskToolsRegistered = coordinator.todoAvailable;
		if (ctx.hasUI) {
			widget = new AgentWidget(coordinator, ctx.ui, activityBoard);
			widget.start();
			const recovery = coordinator.recoverySummary;
			if (recovery.interruptedRunIds.length || recovery.preservedQuestionIds.length) {
				ctx.ui.notify(
					`Subagents V2 recovered ${recovery.interruptedRunIds.length} interrupted run(s) and ${recovery.preservedQuestionIds.length} open question(s).`,
					"warning",
				);
			}
		}
	});

	pi.on("session_shutdown", async () => {
		if (shuttingDown) return shuttingDown;
		shuttingDown = (async () => {
			widget?.dispose();
			widget = undefined;
			await coordinator?.shutdown("session_shutdown");
			coordinator = undefined;
			humanAdapter = undefined;
		})().finally(() => {
			shuttingDown = undefined;
		});
		return shuttingDown;
	});
}
