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
	private streamStart = 0;
	private tps = 0;
	private lastOutputTokens = 0;
	private lastInputTokens = 0;

	/**
	 * Reset state at the start of a new turn.
	 */
	resetForTurn(): void {
		this.streaming = false;
		this.streamStart = 0;
		this.tps = 0;
	}

	/**
	 * Called when streaming starts (first message_update).
	 */
	streamStarted(): void {
		this.streaming = true;
		this.streamStart = performance.now();
	}

	/**
	 * Called on each message_update during streaming.
	 */
	onMessageUpdate(message: AssistantMessage): void {
		if (!this.streaming) {
			this.streamStarted();
		}

		let chars = 0;
		for (const block of message.content) {
			if (block.type === "text") chars += block.text.length;
			else if (block.type === "thinking") chars += block.thinking.length;
		}

		const elapsed = (performance.now() - this.streamStart) / 1000;
		if (elapsed > 0.1) {
			const estimatedTokens = chars / 4;
			this.tps = estimatedTokens / elapsed;
		}
	}

	/**
	 * Called on message_end to finalize TPS with actual usage.
	 */
	onMessageEnd(message: AssistantMessage): void {
		const elapsed = this.streamStart > 0 ? (performance.now() - this.streamStart) / 1000 : 0;
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
