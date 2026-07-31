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

class ScriptedRuntime implements AgentRuntime {
	private agent!: AgentRecord;
	private calls = 0;

	constructor(
		private readonly run: (agent: AgentRecord, call: number, message: RuntimeMessage) => Promise<SegmentOutcome>,
	) {}

	async load(agent: AgentRecord): Promise<void> {
		this.agent = agent;
		agent.sessionFile ??= `/tmp/${agent.id}.jsonl`;
	}

	async runSegment(_run: RunRecord, message: RuntimeMessage): Promise<SegmentOutcome> {
		this.calls++;
		return this.run(this.agent, this.calls, message);
	}

	async steer(): Promise<void> {}
	async abort(_reason: AbortReason): Promise<void> {}
	async unload(): Promise<void> {}
	async dispose(): Promise<void> {}
}

describe("recursive logical coordination", () => {
	it("completes child/question/resume recursion with global concurrency one", async () => {
		const directory = await mkdtemp(join(tmpdir(), "edb-coordinator-recursive-"));
		directories.push(directory);
		const rootMessages: string[] = [];
		const finalResult = Promise.withResolvers<void>();
		let coordinator!: Coordinator;
		let activeSegments = 0;
		let maxActiveSegments = 0;
		const runtimePool = new RuntimePool(
			() =>
				new ScriptedRuntime(async (agent, call) => {
					activeSegments++;
					maxActiveSegments = Math.max(maxActiveSegments, activeSegments);
					try {
						if (agent.displayName === "A" && call === 1) {
							const receipt = await coordinator.spawn(
								coordinator.caller(agent.id, new AbortController().signal),
								{
									prompt: "B work",
									description: "B",
									subagent_type: "tester",
									agent_name: "B",
								},
							);
							return { kind: "waiting_child", waitLinkId: receipt.waitLinkId!, rotateRuntime: false };
						}
						if (agent.displayName === "B" && call === 1) {
							const question = await coordinator.askParent(
								coordinator.caller(agent.id, new AbortController().signal),
								{
									question: "Which color?",
								},
							);
							return { kind: "waiting_parent", questionId: (question as any).id, rotateRuntime: false };
						}
						if (agent.displayName === "A" && call === 2) {
							const question = coordinator
								.listQuestions()
								.find((candidate) => candidate.fromAgentId !== agent.id)!;
							const answer = await coordinator.answerChild(
								coordinator.caller(agent.id, new AbortController().signal),
								{ question_id: question.id, answer: "cobalt" },
							);
							return { kind: "waiting_child", waitLinkId: answer.waitLinkId!, rotateRuntime: false };
						}
						if (agent.displayName === "B" && call === 2) {
							return { kind: "completed", text: "B used cobalt", sessionFile: agent.sessionFile! };
						}
						return { kind: "completed", text: "A received B result", sessionFile: agent.sessionFile! };
					} finally {
						activeSegments--;
					}
				}),
			60_000,
		);
		const questions = new QuestionService(new AgentRegistry());
		const todoClient = {
			available: false,
			request: async () => {
				throw new Error("todo unavailable");
			},
			dispose: () => {},
		} as any;
		coordinator = new Coordinator({
			rootSessionId: "root_recursive",
			cwd: directory,
			settings: { ...DEFAULT_V2_SETTINGS, engine: "v2", maxConcurrentPrompts: 1, maxChildrenPerParent: 2 },
			store: new AtomicStore(directory, "root_recursive", directory),
			runtimePool,
			rootAdapter: {
				deliver(content: string) {
					rootMessages.push(content);
					if (content.includes("A received B result")) finalResult.resolve();
				},
			} as any,
			todoClient,
			questions,
			humanAdapter: new HumanAdapter(),
		});
		await coordinator.start();
		await coordinator.spawn(coordinator.caller("root", new AbortController().signal), {
			prompt: "A work",
			description: "A",
			subagent_type: "coder",
			agent_name: "A",
		});
		await Promise.race([
			finalResult.promise,
			new Promise((_, reject) => setTimeout(() => reject(new Error("recursive scenario timed out")), 3_000)),
		]);
		expect(maxActiveSegments).toBe(1);
		expect(coordinator.listQuestions()).toEqual([
			expect.objectContaining({ text: "Which color?", state: "answered", answer: "cobalt" }),
		]);
		expect(rootMessages.some((message) => message.includes("A received B result"))).toBe(true);
		await coordinator.shutdown("session_shutdown");
	});
});
