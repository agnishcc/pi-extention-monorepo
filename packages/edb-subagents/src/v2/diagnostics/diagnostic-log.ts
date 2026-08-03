import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createId } from "../coordinator/agent-registry.js";
import type { DiagnosticEvent } from "../types.js";

export class DiagnosticLog {
	private readonly recentEvents: DiagnosticEvent[] = [];
	private writeChain = Promise.resolve();

	constructor(
		private readonly directory: string,
		private readonly rootSessionId: string,
		private readonly maxRecent = 200,
	) {}

	record(event: Omit<DiagnosticEvent, "eventId" | "rootSessionId" | "timestamp">): Promise<void> {
		const complete: DiagnosticEvent = {
			...event,
			eventId: createId("evt"),
			rootSessionId: this.rootSessionId,
			timestamp: new Date().toISOString(),
		};
		this.recentEvents.push(complete);
		if (this.recentEvents.length > this.maxRecent)
			this.recentEvents.splice(0, this.recentEvents.length - this.maxRecent);
		this.writeChain = this.writeChain
			.then(async () => {
				await mkdir(this.directory, { recursive: true });
				await appendFile(join(this.directory, "events.jsonl"), `${JSON.stringify(complete)}\n`, "utf8");
			})
			.catch((error) => {
				console.error("[edb-subagents-v2] Failed to write diagnostics:", error);
			});
		return this.writeChain;
	}

	recent(): DiagnosticEvent[] {
		return this.recentEvents.map((event) => structuredClone(event));
	}

	async flush(): Promise<void> {
		await this.writeChain;
	}
}
