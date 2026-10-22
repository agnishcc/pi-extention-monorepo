import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import * as compareModule from "./compare";
import systemPromptWatchExtension, { handlePromptDiffCommand } from "./index";
import * as stateModule from "./state";

type EventHandler = (...args: unknown[]) => unknown;

describe("systemPromptWatchExtension", () => {
	it("registers session_start event listener and slash commands", () => {
		const commands: Record<string, unknown> = {};
		const mockPi = {
			on: vi.fn(),
			registerCommand: vi.fn((name: string, def: unknown) => {
				commands[name] = def;
			}),
		} as unknown as ExtensionAPI;

		systemPromptWatchExtension(mockPi);

		expect(mockPi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
		expect(mockPi.registerCommand).toHaveBeenCalledWith("prompt-diff", expect.any(Object));
		expect(mockPi.registerCommand).toHaveBeenCalledWith("system-prompt-diff", expect.any(Object));
	});

	it("ignores session_start when reason is not startup", async () => {
		const checkSpy = vi.spyOn(stateModule, "checkPromptSource");
		const handlers: Record<string, EventHandler> = {};
		const mockPi = {
			on: vi.fn((event: string, handler: EventHandler) => {
				handlers[event] = handler;
			}),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;

		systemPromptWatchExtension(mockPi);

		const mockCtx = { ui: { notify: vi.fn() } };
		await handlers.session_start?.({ reason: "reload" }, mockCtx);

		expect(checkSpy).not.toHaveBeenCalled();
		checkSpy.mockRestore();
	});

	it("notifies user when prompt source changed", async () => {
		const checkSpy = vi.spyOn(stateModule, "checkPromptSource").mockResolvedValue({
			changed: true,
			firstRun: false,
			previous: { lastSeenPiVersion: "0.82.0" },
			snapshot: {
				piVersion: "0.83.0",
				promptSourcePath: "/path/to/prompt.js",
				promptSourceHash: "hash2",
			},
		});

		const handlers: Record<string, EventHandler> = {};
		const mockPi = {
			on: vi.fn((event: string, handler: EventHandler) => {
				handlers[event] = handler;
			}),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;

		systemPromptWatchExtension(mockPi);

		const mockCtx = { ui: { notify: vi.fn() } };
		await handlers.session_start?.({ reason: "startup" }, mockCtx);

		expect(mockCtx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("Pi default system prompt changed (0.82.0 → 0.83.0)"),
			"warning",
		);

		checkSpy.mockRestore();
	});

	it("does not notify when prompt source is unchanged", async () => {
		const checkSpy = vi.spyOn(stateModule, "checkPromptSource").mockResolvedValue({
			changed: false,
			firstRun: false,
			previous: { lastSeenPiVersion: "0.83.0" },
			snapshot: {
				piVersion: "0.83.0",
				promptSourcePath: "/path/to/prompt.js",
				promptSourceHash: "hash1",
			},
		});

		const handlers: Record<string, EventHandler> = {};
		const mockPi = {
			on: vi.fn((event: string, handler: EventHandler) => {
				handlers[event] = handler;
			}),
			registerCommand: vi.fn(),
		} as unknown as ExtensionAPI;

		systemPromptWatchExtension(mockPi);

		const mockCtx = { ui: { notify: vi.fn() } };
		await handlers.session_start?.({ reason: "startup" }, mockCtx);

		expect(mockCtx.ui.notify).not.toHaveBeenCalled();

		checkSpy.mockRestore();
	});

	it("handlePromptDiffCommand opens custom overlay when UI is available", async () => {
		const bundledSpy = vi.spyOn(compareModule, "getBundledDefaultPrompt").mockResolvedValue({
			prompt: "default prompt text",
			sourcePath: "/path/to/system-prompt.js",
			version: "0.83.0",
		});

		const mockCtx = {
			hasUI: true,
			cwd: "/test",
			getSystemPrompt: vi.fn().mockReturnValue("active prompt text"),
			ui: {
				custom: vi.fn().mockImplementation(async (builder: EventHandler) => {
					const mockTheme = {
						fg: (_c: string, s: string) => s,
						bg: (_c: string, s: string) => s,
						bold: (s: string) => s,
					};
					const overlay = builder({}, mockTheme, {}, vi.fn());
					expect(overlay).toBeTruthy();
				}),
				notify: vi.fn(),
			},
		} as unknown as ExtensionCommandContext;

		await handlePromptDiffCommand("", mockCtx);

		expect(mockCtx.ui.custom).toHaveBeenCalled();
		bundledSpy.mockRestore();
	});

	it("handlePromptDiffCommand logs summary when UI is not available", async () => {
		const bundledSpy = vi.spyOn(compareModule, "getBundledDefaultPrompt").mockResolvedValue({
			prompt: "default prompt text",
			sourcePath: "/path/to/system-prompt.js",
			version: "0.83.0",
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		const mockCtx = {
			hasUI: false,
			cwd: "/test",
			getSystemPrompt: vi.fn().mockReturnValue("active prompt text"),
		} as unknown as ExtensionCommandContext;

		await handlePromptDiffCommand("", mockCtx);

		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("System Prompt Comparison"));
		logSpy.mockRestore();
		bundledSpy.mockRestore();
	});
});
