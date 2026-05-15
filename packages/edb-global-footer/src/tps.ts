/**
 * Token Per Second (TPS) Calculator
 *
 * Tracks streaming throughput and calculates TPS in real-time.
 * - During streaming: estimates TPS from character count / 4
 * - On completion: uses actual output tokens from message usage
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TpsState {
	/** Whether we're currently streaming */
	isStreaming: boolean;
	/** Estimated TPS during streaming, actual after completion */
	tps: number;
	/** Total output tokens from last message */
	lastOutputTokens: number;
	/** Total input tokens from last message */
	lastInputTokens: number;
}

// ── Calculator ───────────────────────────────────────────────────────────────

export class TpsCalculator {
	private streaming = false;
	private lastUpdateAt = 0; // timestamp of last message_update
	private accumulatedMs = 0; // total streaming ms, excluding tool execution time
	private inTool = false; // whether a tool is currently executing
	private tps = 0;
	private lastOutputTokens = 0;
	private lastInputTokens = 0;

	/**
	 * Reset state at the start of a new turn.
	 */
	resetForTurn(): void {
		this.streaming = false;
		this.lastUpdateAt = 0;
		this.accumulatedMs = 0;
		this.inTool = false;
		this.tps = 0;
	}

	/**
	 * Call when a tool starts executing — pauses the streaming clock.
	 */
	onToolStart(): void {
		if (this.streaming && this.lastUpdateAt > 0) {
			// Accumulate streaming time up to this point
			this.accumulatedMs += performance.now() - this.lastUpdateAt;
			this.lastUpdateAt = 0;
		}
		this.inTool = true;
	}

	/**
	 * Call when a tool finishes executing — resumes the streaming clock on next update.
	 */
	onToolEnd(): void {
		this.inTool = false;
		// lastUpdateAt will be reset on the next message_update
	}

	/**
	 * Called on each message_update during streaming.
	 */
	onMessageUpdate(message: AssistantMessage): void {
		const now = performance.now();

		if (!this.streaming) {
			// First update of this streaming burst
			this.streaming = true;
			this.lastUpdateAt = now;
		} else if (this.inTool || this.lastUpdateAt === 0) {
			// Resuming after a tool call — restart the clock segment
			this.lastUpdateAt = now;
			this.inTool = false;
		}

		// Count chars for live estimate
		let chars = 0;
		for (const block of message.content) {
			if (block.type === "text") chars += block.text.length;
			else if (block.type === "thinking") chars += block.thinking.length;
		}

		const elapsed = (this.accumulatedMs + (now - this.lastUpdateAt)) / 1000;
		if (elapsed > 0.1) {
			const estimatedTokens = chars / 4;
			this.tps = estimatedTokens / elapsed;
		}
	}

	/**
	 * Called on message_end to finalize TPS with actual usage.
	 */
	onMessageEnd(message: AssistantMessage): void {
		const now = performance.now();
		// Flush any remaining streaming time
		if (this.lastUpdateAt > 0) {
			this.accumulatedMs += now - this.lastUpdateAt;
			this.lastUpdateAt = 0;
		}
		const elapsed = this.accumulatedMs / 1000;
		const outputTokens = message.usage?.output ?? 0;
		this.lastInputTokens = message.usage?.input ?? 0;
		this.lastOutputTokens = outputTokens;

		if (elapsed > 0.1 && outputTokens > 0) {
			this.tps = outputTokens / elapsed;
		}

		this.streaming = false;
	}

	/**
	 * Get current TPS state for rendering.
	 */
	getState(): TpsState {
		return {
			isStreaming: this.streaming,
			tps: this.tps,
			lastOutputTokens: this.lastOutputTokens,
			lastInputTokens: this.lastInputTokens,
		};
	}
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format TPS number for display.
 */
export function formatTps(tps: number): string {
	if (tps < 1) return "0";
	if (tps < 10) return tps.toFixed(1);
	return tps.toFixed(0);
}
