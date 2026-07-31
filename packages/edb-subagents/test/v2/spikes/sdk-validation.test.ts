import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import {
	createAgentSession,
	createExtensionRuntime,
	defineTool,
	ModelRuntime,
	type ResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function emptyLoader(systemPrompt = "Follow the test script exactly."): ResourceLoader {
	return {
		getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => systemPrompt,
		getAppendSystemPrompt: () => [],
		getSystemPromptSource: () => undefined,
		getAppendSystemPromptSources: () => [],
		extendResources: () => {},
		reload: async () => {},
	};
}

async function createHarness(responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0]) {
	const directory = await mkdtemp(join(tmpdir(), "edb-subagents-v2-sdk-"));
	temporaryDirectories.push(directory);
	const faux = fauxProvider({ provider: `faux-${Math.random().toString(36).slice(2)}` });
	faux.setResponses(responses);
	const modelRuntime = await ModelRuntime.create({ authPath: join(directory, "auth.json"), modelsPath: null });
	modelRuntime.registerNativeProvider(faux.provider);
	return { directory, faux, modelRuntime, model: faux.getModel() };
}

function contextText(context: Context): string {
	return JSON.stringify(context.messages);
}

describe("Pi SDK 0.83 V2 hard-gate spikes", () => {
	it("reopens a persistent child session with its prior context and exact tools", async () => {
		const harness = await createHarness([
			fauxAssistantMessage("I will remember cobalt."),
			(context) =>
				fauxAssistantMessage(
					contextText(context).includes("cobalt") ? "The remembered word is cobalt." : "Context was lost.",
				),
		]);
		const sessionDirectory = join(harness.directory, "sessions");
		const first = await createAgentSession({
			cwd: harness.directory,
			model: harness.model,
			modelRuntime: harness.modelRuntime,
			resourceLoader: emptyLoader(),
			sessionManager: SessionManager.create(harness.directory, sessionDirectory),
			settingsManager: SettingsManager.inMemory(),
			tools: ["read"],
		});
		expect(first.extensionsResult.extensions).toHaveLength(0);
		expect(first.session.getActiveToolNames()).toEqual(["read"]);
		await first.session.prompt("Remember the word cobalt.");
		const sessionFile = first.session.sessionFile;
		expect(sessionFile).toBeTruthy();
		first.session.dispose();

		const reopened = await createAgentSession({
			cwd: harness.directory,
			model: harness.model,
			modelRuntime: harness.modelRuntime,
			resourceLoader: emptyLoader(),
			sessionManager: SessionManager.open(sessionFile!, sessionDirectory, harness.directory),
			settingsManager: SettingsManager.inMemory(),
			tools: ["read"],
		});
		await reopened.session.prompt("What word did I ask you to remember?");
		expect(JSON.stringify(reopened.session.messages)).toContain("remembered word is cobalt");
		expect(reopened.session.sessionFile).toBe(sessionFile);
		reopened.session.dispose();
		expect((await readFile(sessionFile!, "utf8")).trim().split("\n").length).toBeGreaterThan(4);
	});

	it("terminates on ask_parent and coherently resumes the same session", async () => {
		const harness = await createHarness([
			fauxAssistantMessage(fauxToolCall("ask_parent", { question: "Which color?" })),
			(context) =>
				fauxAssistantMessage(
					contextText(context).includes("Parent answer: cobalt") ? "Continuing with cobalt." : "Missing answer.",
				),
		]);
		const control = { requestedYield: null as null | { reason: "question"; entityId: string } };
		const askParent = defineTool({
			name: "ask_parent",
			label: "Ask parent",
			description: "Yield while asking the parent.",
			parameters: Type.Object({ question: Type.String() }),
			async execute() {
				control.requestedYield = { reason: "question", entityId: "qst_test" };
				return { content: [{ type: "text", text: "Question persisted; waiting." }], details: {}, terminate: true };
			},
		});
		const session = (
			await createAgentSession({
				cwd: harness.directory,
				model: harness.model,
				modelRuntime: harness.modelRuntime,
				resourceLoader: emptyLoader(),
				sessionManager: SessionManager.create(harness.directory, join(harness.directory, "sessions")),
				settingsManager: SettingsManager.inMemory(),
				tools: ["ask_parent"],
				customTools: [askParent],
			})
		).session;
		await session.prompt("Ask the parent which color to use.");
		expect(control.requestedYield).toEqual({ reason: "question", entityId: "qst_test" });
		expect(harness.faux.state.callCount).toBe(1);
		await session.prompt("Parent answer: cobalt");
		expect(harness.faux.state.callCount).toBe(2);
		expect(JSON.stringify(session.messages)).toContain("Continuing with cobalt");
		session.dispose();
	});

	it("stops model continuation after a yielding tool in a parallel batch", async () => {
		const harness = await createHarness([
			fauxAssistantMessage([
				fauxToolCall("ask_parent", { question: "Need input" }),
				fauxToolCall("side_effect", { value: "recorded" }),
			]),
			fauxAssistantMessage("This response must be aborted."),
			(context) =>
				fauxAssistantMessage(
					contextText(context).includes("Parent answer: continue")
						? "Resumed after the answer."
						: "Missing answer.",
				),
		]);
		const events: string[] = [];
		let sessionToAbort: Awaited<ReturnType<typeof createAgentSession>>["session"];
		const askParent = defineTool({
			name: "ask_parent",
			label: "Ask parent",
			description: "Yield while asking the parent.",
			executionMode: "parallel",
			parameters: Type.Object({ question: Type.String() }),
			async execute() {
				events.push("suspend_for_question");
				void sessionToAbort.abort();
				return { content: [{ type: "text", text: "waiting" }], details: {}, terminate: true };
			},
		});
		const sideEffect = defineTool({
			name: "side_effect",
			label: "Side effect",
			description: "Test parallel execution.",
			executionMode: "parallel",
			parameters: Type.Object({ value: Type.String() }),
			async execute(_id, params) {
				events.push(params.value);
				return { content: [{ type: "text", text: "done" }], details: {} };
			},
		});
		const session = (
			await createAgentSession({
				cwd: harness.directory,
				model: harness.model,
				modelRuntime: harness.modelRuntime,
				resourceLoader: emptyLoader(),
				sessionManager: SessionManager.create(harness.directory, join(harness.directory, "sessions")),
				settingsManager: SettingsManager.inMemory(),
				tools: ["ask_parent", "side_effect"],
				customTools: [askParent, sideEffect],
			})
		).session;
		sessionToAbort = session;
		await session.prompt("Run the scripted parallel tool batch.");
		expect(events).toEqual(expect.arrayContaining(["suspend_for_question", "recorded"]));
		expect(harness.faux.state.callCount).toBe(2);
		const lastAssistant = [...session.messages].reverse().find((message) => message.role === "assistant");
		expect(lastAssistant?.stopReason).toBe("aborted");
		const sessionFile = session.sessionFile!;
		session.dispose();
		const reopened = (
			await createAgentSession({
				cwd: harness.directory,
				model: harness.model,
				modelRuntime: harness.modelRuntime,
				resourceLoader: emptyLoader(),
				sessionManager: SessionManager.open(sessionFile, join(harness.directory, "sessions"), harness.directory),
				settingsManager: SettingsManager.inMemory(),
				tools: ["ask_parent", "side_effect"],
				customTools: [askParent, sideEffect],
			})
		).session;
		await reopened.prompt("Parent answer: continue");
		expect(harness.faux.state.callCount).toBe(3);
		expect(JSON.stringify(reopened.messages)).toContain("Resumed after the answer");
		reopened.dispose();
	});

	it("resumes a logically waiting root through a structured custom message", async () => {
		const harness = await createHarness([
			fauxAssistantMessage(fauxToolCall("wait_for_child", { runId: "run_child" })),
			(context) =>
				fauxAssistantMessage(
					contextText(context).includes("msg_child_completed")
						? "Root resumed with the child result."
						: "No result.",
				),
		]);
		const waitForChild = defineTool({
			name: "wait_for_child",
			label: "Wait for child",
			description: "Register a logical child wait.",
			parameters: Type.Object({ runId: Type.String() }),
			async execute() {
				return { content: [{ type: "text", text: "wait registered" }], details: {}, terminate: true };
			},
		});
		const session = (
			await createAgentSession({
				cwd: harness.directory,
				model: harness.model,
				modelRuntime: harness.modelRuntime,
				resourceLoader: emptyLoader(),
				sessionManager: SessionManager.inMemory(harness.directory),
				settingsManager: SettingsManager.inMemory(),
				tools: ["wait_for_child"],
				customTools: [waitForChild],
			})
		).session;
		await session.prompt("Wait for the scripted child.");
		expect(harness.faux.state.callCount).toBe(1);
		await session.sendCustomMessage(
			{
				customType: "edb-subagents-v2",
				content: "[msg_child_completed] Child run run_child completed: cobalt",
				display: false,
				details: { messageId: "msg_child_completed", runId: "run_child" },
			},
			{ triggerTurn: true },
		);
		expect(harness.faux.state.callCount).toBe(2);
		expect(JSON.stringify(session.messages)).toContain("Root resumed with the child result");
		session.dispose();
	});

	it("releases the only prompt permit across recursive logical waits", async () => {
		let available = 1;
		const trace: string[] = [];
		const runSegment = async (name: string, segment: () => Promise<void>) => {
			expect(available).toBe(1);
			available--;
			trace.push(`${name}:start`);
			try {
				await segment();
			} finally {
				available++;
				trace.push(`${name}:yield`);
			}
		};

		await runSegment("A", async () => {
			trace.push("A:wait-B");
		});
		await runSegment("B", async () => {
			trace.push("B:ask-A");
		});
		await runSegment("A", async () => {
			trace.push("A:answer-B");
		});
		await runSegment("B", async () => {
			trace.push("B:complete");
		});
		await runSegment("A", async () => {
			trace.push("A:complete");
		});

		expect(available).toBe(1);
		expect(trace).toEqual([
			"A:start",
			"A:wait-B",
			"A:yield",
			"B:start",
			"B:ask-A",
			"B:yield",
			"A:start",
			"A:answer-B",
			"A:yield",
			"B:start",
			"B:complete",
			"B:yield",
			"A:start",
			"A:complete",
			"A:yield",
		]);
	});
});
