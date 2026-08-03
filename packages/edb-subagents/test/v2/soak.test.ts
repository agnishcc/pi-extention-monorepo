import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRegistry } from "../../src/v2/coordinator/agent-registry.js";
import { Coordinator } from "../../src/v2/coordinator/coordinator.js";
import { AtomicStore } from "../../src/v2/persistence/atomic-store.js";
import { HumanAdapter } from "../../src/v2/questions/human-adapter.js";
import { QuestionService } from "../../src/v2/questions/question-service.js";
import { RuntimePool } from "../../src/v2/runtime/runtime-pool.js";
import { DEFAULT_V2_SETTINGS } from "../../src/v2/settings.js";
import type {
	AbortReason,
	AgentRecord,
	AgentRuntime,
	RunRecord,
	RuntimeMessage,
	SegmentOutcome,
} from "../../src/v2/types.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error(message);
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

class SoakRuntime implements AgentRuntime {
	private agent!: AgentRecord;

	constructor(private readonly run: (agent: AgentRecord, message: RuntimeMessage) => Promise<SegmentOutcome>) {}

	async load(agent: AgentRecord): Promise<void> {
		this.agent = agent;
		agent.sessionFile ??= `/tmp/${agent.id}.jsonl`;
	}

	async runSegment(_run: RunRecord, message: RuntimeMessage): Promise<SegmentOutcome> {
		return this.run(this.agent, message);
	}

	async steer(): Promise<void> {}
	async abort(_reason: AbortReason): Promise<void> {}
	async unload(): Promise<void> {}
	async dispose(): Promise<void> {}
}

class BlockingRuntime implements AgentRuntime {
	private readonly outcome = Promise.withResolvers<SegmentOutcome>();
	readonly started = Promise.withResolvers<void>();

	async load(agent: AgentRecord): Promise<void> {
		agent.sessionFile ??= `/tmp/${agent.id}.jsonl`;
	}

	async runSegment(): Promise<SegmentOutcome> {
		this.started.resolve();
		return this.outcome.promise;
	}

	async steer(): Promise<void> {}
	async abort(reason: AbortReason): Promise<void> {
		this.outcome.resolve({ kind: "aborted", reason });
	}
	async unload(): Promise<void> {}
	async dispose(): Promise<void> {}
}

describe("V2 soak scenarios", () => {
	it("preserves a linked task when shutdown interrupts an active run", async () => {
		const directory = await mkdtemp(join(tmpdir(), "edb-subagents-shutdown-soak-"));
		directories.push(directory);
		const runtime = new BlockingRuntime();
		const taskMethods: string[] = [];
		const coordinator = new Coordinator({
			rootSessionId: "root_shutdown_soak",
			cwd: directory,
			settings: { ...DEFAULT_V2_SETTINGS, engine: "v2" },
			store: new AtomicStore(directory, "root_shutdown_soak", directory),
			runtimePool: new RuntimePool(() => runtime, 60_000),
			rootAdapter: { deliver: () => {} } as any,
			todoClient: {
				available: true,
				request: async (method: string) => {
					taskMethods.push(method);
					return {};
				},
				dispose: () => {},
			} as any,
			questions: new QuestionService(new AgentRegistry()),
			humanAdapter: new HumanAdapter(),
		});
		await coordinator.start();
		const receipt = await coordinator.spawn(coordinator.caller("root", new AbortController().signal), {
			prompt: "keep running",
			description: "shutdown target",
			subagent_type: "coder",
			run_in_background: true,
			task_id: "T-shutdown",
		});
		await runtime.started.promise;
		await coordinator.shutdown("session_shutdown");
		await Promise.resolve();
		expect(coordinator.registry.getRun(receipt.runId).state).toBe("interrupted");
		expect(taskMethods).toEqual(["assign"]);
	});

	it("unwinds depth-four foreground recursion at concurrency one", async () => {
		const directory = await mkdtemp(join(tmpdir(), "edb-subagents-depth-soak-"));
		directories.push(directory);
		let coordinator!: Coordinator;
		let active = 0;
		let maximumActive = 0;
		const rootMessages: string[] = [];
		const runtimePool = new RuntimePool(
			() =>
				new SoakRuntime(async (agent) => {
					active++;
					maximumActive = Math.max(maximumActive, active);
					try {
						const depth = coordinator.registry.depth(agent.id);
						const run = coordinator.registry.getRun(agent.currentRunId!);
						if (run.segmentCount === 1 && depth < 4) {
							const receipt = await coordinator.spawn(
								coordinator.caller(agent.id, new AbortController().signal),
								{
									prompt: `depth ${depth + 1}`,
									description: `depth ${depth + 1}`,
									subagent_type: "coder",
									agent_name: `depth-${depth + 1}`,
								},
							);
							return { kind: "waiting_child", waitLinkId: receipt.waitLinkId!, rotateRuntime: false };
						}
						return { kind: "completed", text: `completed depth ${depth}`, sessionFile: agent.sessionFile! };
					} finally {
						active--;
					}
				}),
			60_000,
		);
		coordinator = createCoordinator(
			directory,
			"root_depth_soak",
			runtimePool,
			{
				maxConcurrentPrompts: 1,
				maxDepth: 4,
			},
			(content) => rootMessages.push(content),
		);
		await coordinator.start();
		await coordinator.spawn(coordinator.caller("root", new AbortController().signal), {
			prompt: "depth 1",
			description: "depth 1",
			subagent_type: "coder",
			agent_name: "depth-1",
		});
		const depth1Agent = [...coordinator.registry.agents.values()].find((agent) => agent.displayName === "depth-1")!;
		await waitFor(
			() =>
				[...coordinator.registry.runs.values()].some(
					(run) =>
						run.agentId === depth1Agent.id &&
						run.state === "completed" &&
						run.result?.text === "completed depth 1",
				),
			"depth soak failed",
		);
		expect(rootMessages.some((message) => message.includes("completed — use get_subagent_result"))).toBe(true);
		expect(rootMessages.some((message) => message.includes("completed depth 1"))).toBe(false);
		expect(coordinator.registry.depth(coordinator.registry.descendants("root").at(-1)!.id)).toBe(4);
		expect(maximumActive).toBe(1);
		await coordinator.shutdown("session_shutdown");
	});

	it("runs 20 parallel background children under concurrency four", async () => {
		const directory = await mkdtemp(join(tmpdir(), "edb-subagents-parallel-soak-"));
		directories.push(directory);
		let active = 0;
		let maximumActive = 0;
		const runtimePool = new RuntimePool(
			() =>
				new SoakRuntime(async (agent) => {
					active++;
					maximumActive = Math.max(maximumActive, active);
					await new Promise((resolve) => setTimeout(resolve, 10));
					active--;
					return { kind: "completed", text: `done ${agent.id}`, sessionFile: agent.sessionFile! };
				}),
			60_000,
		);
		const coordinator = createCoordinator(directory, "root_parallel_soak", runtimePool, {
			maxConcurrentPrompts: 4,
			maxChildrenPerParent: 20,
			maxActiveDescendants: 20,
		});
		await coordinator.start();
		const caller = coordinator.caller("root", new AbortController().signal);
		const receipts = await Promise.all(
			Array.from({ length: 20 }, (_, index) =>
				coordinator.spawn(caller, {
					prompt: `background ${index}`,
					description: `background ${index}`,
					subagent_type: "coder",
					agent_name: `worker-${index}`,
					run_in_background: true,
				}),
			),
		);
		await waitFor(
			() => receipts.every((receipt) => coordinator.registry.getRun(receipt.runId).state === "completed"),
			"parallel soak did not complete",
		);
		expect(maximumActive).toBe(4);
		expect(coordinator.registry.descendants("root")).toHaveLength(20);
		await coordinator.shutdown("session_shutdown");
	});

	it("reuses one persistent agent for 20 sequential follow-ups", async () => {
		const directory = await mkdtemp(join(tmpdir(), "edb-subagents-followup-soak-"));
		directories.push(directory);
		const messages: string[] = [];
		const runtimePool = new RuntimePool(
			() =>
				new SoakRuntime(async (agent, message) => {
					messages.push(message.text);
					return { kind: "completed", text: `done ${messages.length}`, sessionFile: agent.sessionFile! };
				}),
			60_000,
		);
		const coordinator = createCoordinator(directory, "root_followup_soak", runtimePool);
		await coordinator.start();
		const caller = coordinator.caller("root", new AbortController().signal);
		const initial = await coordinator.spawn(caller, {
			prompt: "initial",
			description: "reusable",
			subagent_type: "coder",
			agent_name: "reusable",
			run_in_background: true,
		});
		await waitFor(() => coordinator.registry.getRun(initial.runId).state === "completed", "initial run failed");
		for (let index = 0; index < 20; index++) {
			const receipt = await coordinator.sendFollowup(caller, initial.agentId, `follow-up ${index}`);
			await waitFor(
				() => coordinator.registry.getRun(receipt.runId).state === "completed",
				`follow-up ${index} failed`,
			);
		}
		const agentRuns = [...coordinator.registry.runs.values()].filter((run) => run.agentId === initial.agentId);
		expect(agentRuns).toHaveLength(21);
		expect(new Set(agentRuns.map((run) => run.agentId))).toEqual(new Set([initial.agentId]));
		expect(messages).toEqual(["initial", ...Array.from({ length: 20 }, (_, index) => `follow-up ${index}`)]);
		await coordinator.shutdown("session_shutdown");
	});
});

function createCoordinator(
	directory: string,
	rootSessionId: string,
	runtimePool: RuntimePool,
	overrides: Partial<typeof DEFAULT_V2_SETTINGS> = {},
	rootDeliver: (content: string) => void = () => {},
): Coordinator {
	return new Coordinator({
		rootSessionId,
		cwd: directory,
		settings: { ...DEFAULT_V2_SETTINGS, ...overrides, engine: "v2" },
		store: new AtomicStore(directory, rootSessionId, directory),
		runtimePool,
		rootAdapter: { deliver: rootDeliver } as any,
		todoClient: { available: false, dispose: () => {} } as any,
		questions: new QuestionService(new AgentRegistry()),
		humanAdapter: new HumanAdapter(),
	});
}
