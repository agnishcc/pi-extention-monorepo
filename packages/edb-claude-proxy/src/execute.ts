import { spawn } from "node:child_process";
import * as path from "node:path";
import { readFileForContext } from "./cli";
import type { ClaudeProxyDetails, ToolCallRecord } from "./types";

// ── Execute ────────────────────────────────────────────────────────────────────

export async function execute(
	claudePath: string,
	params: any,
	signal: AbortSignal | undefined,
	onUpdate: ((update: { content: Array<{ type: "text"; text: string }>; details?: any }) => void) | undefined,
	ctx: any,
): Promise<{ content: Array<{ type: string; text: string }>; details: ClaudeProxyDetails; isError: boolean }> {
	const workDir = params.cwd ?? ctx.cwd;

	// ----- 1. Build context from requested files -----
	let fullPrompt = params.prompt;
	const filesInjected: string[] = [];

	if (params.files && params.files.length > 0) {
		const parts: string[] = [];
		for (const filePath of params.files) {
			const absPath = path.isAbsolute(filePath) ? filePath : path.join(workDir, filePath);
			filesInjected.push(absPath);
			parts.push(await readFileForContext(absPath));
		}
		fullPrompt = `${parts.join("\n")}\n\n${fullPrompt}`;
	}

	// ----- 2. Build CLI arguments -----
	const args: string[] = [
		"--print",
		"--output-format",
		"stream-json",
		"--verbose",
		"--include-partial-messages",
		"--input-format",
		"text",
		"--dangerously-skip-permissions",
		"--no-session-persistence",
	];

	if (params.model) args.push("--model", params.model);
	if (params.systemPrompt) args.push("--system-prompt", params.systemPrompt);

	const tools = params.allowedTools ?? ["Read"];
	if (tools.length === 0) {
		args.push("--tools", "");
	} else {
		args.push("--allowed-tools", ...tools);
	}

	// ----- 3. Spawn Claude -----
	const details: ClaudeProxyDetails = {
		streaming: true,
		toolCalls: [],
		prompt: params.prompt,
		filesInjected: filesInjected.length > 0 ? filesInjected : undefined,
	};

	const pendingToolCalls = new Map<string, ToolCallRecord>();
	let finalText = "";
	let latestPartialText = "";
	let spawnError = "";

	const emitUpdate = () => {
		onUpdate?.({
			content: [{ type: "text" as const, text: latestPartialText || "(waiting for Claude…)" }],
			details: { ...details },
		});
	};

	const exitCode = await new Promise<number>((resolve) => {
		const proc = spawn(claudePath, args, {
			cwd: workDir,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env },
		});

		proc.stdin.write(fullPrompt, "utf-8");
		proc.stdin.end();

		let buffer = "";

		const processLine = (line: string) => {
			if (!line.trim()) return;
			let event: Record<string, unknown>;
			try {
				event = JSON.parse(line) as Record<string, unknown>;
			} catch {
				return;
			}

			switch (event.type) {
				case "system": {
					if ((event as any).session_id) details.sessionId = (event as any).session_id as string;
					break;
				}
				case "assistant": {
					const msg = (event as any).message as any;
					if (!msg?.content) break;
					for (const block of msg.content as any[]) {
						if (block.type === "text") {
							latestPartialText = block.text as string;
							emitUpdate();
						} else if (block.type === "tool_use") {
							const record: ToolCallRecord = { id: block.id, name: block.name, input: block.input ?? {} };
							pendingToolCalls.set(record.id, record);
							details.toolCalls = [...details.toolCalls, record];
							emitUpdate();
						}
					}
					if (msg.model && !details.model) details.model = msg.model as string;
					break;
				}
				case "tool_result": {
					const id = (event as any).tool_use_id as string;
					const record = pendingToolCalls.get(id);
					if (record) {
						const raw = (event as any).content;
						record.result = typeof raw === "string" ? raw : JSON.stringify(raw);
						record.isError = Boolean((event as any).is_error);
						details.toolCalls = details.toolCalls.map((t) => (t.id === id ? { ...record } : t));
						emitUpdate();
					}
					break;
				}
				case "result": {
					finalText = ((event as any).result as string) ?? latestPartialText;
					details.costUsd = (event as any).total_cost_usd as number;
					details.streaming = false;
					if ((event as any).subtype !== "success" || (event as any).is_error) {
						spawnError = ((event as any).error as string) || finalText || "Claude reported an error";
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
			spawnError += chunk.toString("utf-8");
		});

		proc.on("close", (code) => {
			if (buffer.trim()) processLine(buffer);
			details.exitCode = code ?? 0;
			resolve(code ?? 0);
		});

		proc.on("error", (err) => {
			spawnError = `Failed to spawn claude CLI: ${err.message}\n\nMake sure 'claude' is on your PATH or set the CLAUDE_PATH environment variable.`;
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
	const isError = exitCode !== 0 || Boolean(spawnError && !finalText);
	const responseText = isError ? spawnError || "(claude exited with no output)" : finalText || "(no output)";

	return { content: [{ type: "text" as const, text: responseText }], details, isError };
}
