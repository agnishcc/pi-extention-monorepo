import { spawn } from "node:child_process";
import * as path from "node:path";
import { readFileForContext } from "./cli";
import type { GeminiProxyDetails, GeminiStreamEvent, ToolCallRecord } from "./types";

// ── Execute ────────────────────────────────────────────────────────────────────

export async function execute(
	geminiPath: string,
	params: any,
	signal: AbortSignal | undefined,
	onUpdate: ((update: { content: Array<{ type: "text"; text: string }>; details?: any }) => void) | undefined,
	ctx: any,
): Promise<{ content: Array<{ type: string; text: string }>; details: GeminiProxyDetails; isError: boolean }> {
	const workDir = params.cwd ?? ctx.cwd;
	const approvalMode = params.approvalMode ?? "yolo";

	// ----- 1. Build stdin payload -----
	const stdinParts: string[] = [];
	if (params.systemPrompt) {
		stdinParts.push(`<instructions>\n${params.systemPrompt}\n</instructions>`);
	}

	const filesInjected: string[] = [];
	if (params.files && params.files.length > 0) {
		for (const filePath of params.files) {
			const absPath = path.isAbsolute(filePath) ? filePath : path.join(workDir, filePath);
			filesInjected.push(absPath);
			stdinParts.push(await readFileForContext(absPath));
		}
	}
	stdinParts.push(params.prompt);
	const stdinPayload = stdinParts.join("\n\n");

	// ----- 2. Build CLI arguments -----
	const args: string[] = ["--output-format", "stream-json"];
	if (params.model) args.push("--model", params.model);
	if (approvalMode === "yolo") {
		args.push("--yolo");
	} else {
		args.push("--approval-mode", approvalMode);
	}
	if (params.includeDirectories && params.includeDirectories.length > 0) {
		for (const dir of params.includeDirectories) {
			const absDir = path.isAbsolute(dir) ? dir : path.join(workDir, dir);
			args.push("--include-directories", absDir);
		}
	}

	// ----- 3. Spawn Gemini -----
	const details: GeminiProxyDetails = {
		streaming: true,
		toolCalls: [],
		filesInjected: filesInjected.length > 0 ? filesInjected : undefined,
	};

	const pendingToolCalls = new Map<string, ToolCallRecord>();
	let assistantText = "";
	let spawnError = "";
	let _finalStatus: "success" | "error" = "success";
	// eslint-disable-next-line prefer-const
	let hadError = false;

	const emitUpdate = () => {
		onUpdate?.({
			content: [{ type: "text" as const, text: assistantText || "(waiting for Gemini…)" }],
			details: { ...details },
		});
	};

	const exitCode = await new Promise<number>((resolve) => {
		const proc = spawn(geminiPath, args, {
			cwd: workDir,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
		});

		proc.stdin.write(stdinPayload, "utf-8");
		proc.stdin.end();

		let buffer = "";

		const processLine = (line: string) => {
			if (!line.trim()) return;
			let event: GeminiStreamEvent;
			try {
				event = JSON.parse(line) as GeminiStreamEvent;
			} catch {
				return;
			}

			switch (event.type) {
				case "init": {
					details.sessionId = event.session_id;
					details.model = event.model;
					break;
				}
				case "message": {
					if (event.role !== "assistant") break;
					if (event.delta) {
						assistantText += event.content;
					} else {
						assistantText = event.content;
					}
					emitUpdate();
					break;
				}
				case "tool_use": {
					const record: ToolCallRecord = {
						id: event.tool_id,
						name: event.tool_name,
						parameters: event.parameters,
					};
					pendingToolCalls.set(record.id, record);
					details.toolCalls = [...details.toolCalls, record];
					emitUpdate();
					break;
				}
				case "tool_result": {
					const record = pendingToolCalls.get(event.tool_id);
					if (record) {
						record.status = event.status;
						record.output = event.output ?? event.error?.message;
						details.toolCalls = details.toolCalls.map((t) => (t.id === event.tool_id ? { ...record } : t));
						emitUpdate();
					}
					break;
				}
				case "error": {
					if (event.severity === "error") spawnError += (spawnError ? "\n" : "") + event.message;
					break;
				}
				case "result": {
					details.streaming = false;
					_finalStatus = event.status;
					if (event.status === "error") hadError = true;
					if (event.stats) {
						details.totalTokens = event.stats.total_tokens;
						details.durationMs = event.stats.duration_ms;
					}
					if (event.status === "error" && event.error) {
						spawnError = event.error.message || "Gemini reported an error";
					}
					break;
				}
			}
		};

		proc.stdout.on("data", (chunk) => {
			buffer += chunk.toString("utf-8");
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) processLine(line);
		});

		proc.stderr.on("data", (chunk) => {
			const IGNORED = [
				"Loaded cached credentials",
				"YOLO mode is enabled",
				"All tool calls will be automatically",
				"Skill ",
				"overriding the built-in",
				"gemini-cli",
			];
			const errorLines = chunk
				.toString("utf-8")
				.split("\n")
				.filter((l: string) => l.trim() && !IGNORED.some((prefix) => l.includes(prefix)));
			if (errorLines.length > 0) spawnError += (spawnError ? "\n" : "") + errorLines.join("\n");
		});

		proc.on("close", (code) => {
			if (buffer.trim()) processLine(buffer);
			details.exitCode = code ?? 0;
			resolve(code ?? 0);
		});

		proc.on("error", (err) => {
			spawnError = `Failed to spawn gemini CLI: ${err.message}\n\nMake sure 'gemini' is on your PATH (npm install -g @google/gemini-cli) or set GEMINI_PATH.`;
			details.exitCode = 1;
			resolve(1);
		});

		if (signal) {
			const kill = () => {
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL");
				}, 5000);
			};
			if (signal.aborted) kill();
			else signal.addEventListener("abort", kill, { once: true });
		}
	});

	// ----- 4. Return result -----
	const isError = exitCode !== 0 || hadError || (Boolean(spawnError) && !assistantText);
	const responseText = isError ? spawnError || "(gemini exited with no output)" : assistantText || "(no output)";

	return { content: [{ type: "text" as const, text: responseText }], details, isError };
}
