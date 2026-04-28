import { spawn } from "node:child_process";

// ── Process runner ─────────────────────────────────────────────────────────────

type UpdateFn =
	| ((update: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }) => void)
	| undefined;

/**
 * Spawns pi in JSON mode, parses the stream-json event stream line by line,
 * forwards tool activity as progress updates, and resolves with the final
 * assistant answer text.
 */
export function runAndParse(
	cmd: string,
	args: string[],
	cwd: string,
	signal: AbortSignal | undefined,
	onUpdate: UpdateFn,
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, {
			cwd,
			env: { ...process.env },
			stdio: ["ignore", "pipe", "pipe"],
		});

		const onAbort = () => {
			child.kill("SIGTERM");
			reject(new Error("Aborted"));
		};
		signal?.addEventListener("abort", onAbort, { once: true });

		let lineBuffer = "";
		let finalAnswer = "";

		// ── Parse JSON event stream line by line ──────────────────────────────
		child.stdout.on("data", (chunk: Buffer) => {
			lineBuffer += chunk.toString();
			const lines = lineBuffer.split("\n");
			lineBuffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					const event = JSON.parse(trimmed);
					handleEvent(event, onUpdate, (answer) => {
						finalAnswer = answer;
					});
				} catch {
					// Non-JSON line — ignore
				}
			}
		});

		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});

		child.on("error", (err) => {
			signal?.removeEventListener("abort", onAbort);
			reject(err);
		});

		child.on("close", (code) => {
			signal?.removeEventListener("abort", onAbort);
			if (finalAnswer) {
				resolve(finalAnswer);
			} else if (code === 0) {
				resolve("(no findings)");
			} else {
				reject(new Error(`pi exited ${code}${stderr ? `: ${stderr.slice(0, 400)}` : ""}`));
			}
		});
	});
}

// ── Event handler ──────────────────────────────────────────────────────────────

function handleEvent(event: any, onUpdate: UpdateFn, setFinalAnswer: (answer: string) => void): void {
	// Forward tool activity as progress updates
	if (onUpdate && event.type === "tool_execution_start") {
		if (event.toolName === "bash") {
			const cmd = ((event.args?.command as string) ?? "").split("\n")[0]?.slice(0, 80);
			onUpdate({ content: [{ type: "text" as const, text: `$ ${cmd}` }], details: {} });
		} else if (event.toolName === "read") {
			const p = (event.args?.path as string) ?? "";
			onUpdate({ content: [{ type: "text" as const, text: `Reading ${p}` }], details: {} });
		}
	}

	// Extract the final answer from the last assistant message
	if (event.type === "agent_end") {
		const messages: any[] = event.messages ?? [];
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg?.role === "assistant") {
				setFinalAnswer(extractText(msg));
				break;
			}
		}
	}
}

// ── Text extractor ─────────────────────────────────────────────────────────────

export function extractText(message: any): string {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block: any) => block?.type === "text")
		.map((block: any) => block.text as string)
		.join("")
		.trim();
}
