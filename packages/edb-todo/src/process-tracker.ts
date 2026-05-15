/**
 * process-tracker.ts — Background process management for tasks.
 *
 * Tracks spawned child processes, buffers their output, and supports
 * blocking wait and graceful stop (SIGTERM → 5s → SIGKILL).
 */

import type { ChildProcess } from "node:child_process";

export interface BackgroundProcess {
	taskId: string;
	pid: number;
	command?: string;
	output: string[];
	status: "running" | "completed" | "error" | "stopped";
	exitCode?: number;
	startedAt: number;
	completedAt?: number;
	proc: ChildProcess;
	waiters: Array<() => void>;
}

export interface ProcessOutput {
	output: string;
	status: BackgroundProcess["status"];
	exitCode?: number;
	startedAt: number;
	completedAt?: number;
	command?: string;
}

export class ProcessTracker {
	private processes = new Map<string, BackgroundProcess>();

	/** Register a spawned child process for a task. */
	track(taskId: string, proc: ChildProcess, command?: string): void {
		const bp: BackgroundProcess = {
			taskId,
			pid: proc.pid!,
			command,
			output: [],
			status: "running",
			startedAt: Date.now(),
			proc,
			waiters: [],
		};

		proc.stdout?.on("data", (data: Buffer) => {
			bp.output.push(data.toString());
		});
		proc.stderr?.on("data", (data: Buffer) => {
			bp.output.push(data.toString());
		});

		proc.on("close", (code) => {
			if (bp.status === "running") bp.status = code === 0 ? "completed" : "error";
			bp.exitCode = code ?? undefined;
			bp.completedAt = Date.now();
			for (const resolve of bp.waiters) resolve();
			bp.waiters = [];
		});

		proc.on("error", (err) => {
			if (bp.status === "running") {
				bp.status = "error";
				bp.output.push(`Process error: ${err.message}`);
				bp.completedAt = Date.now();
				for (const resolve of bp.waiters) resolve();
				bp.waiters = [];
			}
		});

		this.processes.set(taskId, bp);
	}

	/** Get current output and status for a task's process. */
	getOutput(taskId: string): ProcessOutput | undefined {
		const bp = this.processes.get(taskId);
		if (!bp) return undefined;
		return {
			output: bp.output.join(""),
			status: bp.status,
			exitCode: bp.exitCode,
			startedAt: bp.startedAt,
			completedAt: bp.completedAt,
			command: bp.command,
		};
	}

	/** Wait for a task's process to complete, with timeout. Returns output or undefined on timeout. */
	waitForCompletion(taskId: string, timeout: number, signal?: AbortSignal): Promise<ProcessOutput | undefined> {
		const bp = this.processes.get(taskId);
		if (!bp) return Promise.resolve(undefined);
		if (bp.status !== "running") return Promise.resolve(this.getOutput(taskId));

		return new Promise<ProcessOutput | undefined>((resolve) => {
			let settled = false;
			const self = this;

			function finish() {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(self.getOutput(taskId));
			}

			const timer = setTimeout(finish, timeout);
			bp.waiters.push(finish);
			signal?.addEventListener("abort", finish, { once: true });
		});
	}

	/** Stop a task's background process gracefully. SIGTERM → wait 5s → SIGKILL. */
	async stop(taskId: string): Promise<boolean> {
		const bp = this.processes.get(taskId);
		if (!bp || bp.status !== "running") return false;

		bp.status = "stopped";
		bp.proc.kill("SIGTERM");

		await new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				try {
					bp.proc.kill("SIGKILL");
				} catch {
					/* already dead */
				}
				resolve();
			}, 5000);
			bp.proc.on("close", () => {
				clearTimeout(timer);
				resolve();
			});
		});

		bp.completedAt = Date.now();
		for (const resolve of bp.waiters) resolve();
		bp.waiters = [];
		return true;
	}

	/** Check whether a task has an active tracked process. */
	has(taskId: string): boolean {
		return this.processes.has(taskId);
	}
}
