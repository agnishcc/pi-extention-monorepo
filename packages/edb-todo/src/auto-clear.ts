/**
 * auto-clear.ts — Turn-based auto-clearing of completed tasks.
 *
 * Two modes:
 * - "on_task_complete": each completed task gets its own countdown, deleted individually
 * - "on_list_complete": countdown starts when ALL tasks are completed, cleared as a batch
 */

import type { FileTaskStore } from "./file-store.js";

export type AutoClearMode = "never" | "on_list_complete" | "on_task_complete";

export class AutoClearManager {
	/** Per-task: turn when task was marked completed ("on_task_complete" mode). */
	private completedAtTurn = new Map<string, number>();
	/** Turn when ALL tasks became completed ("on_list_complete" mode). */
	private allCompletedAtTurn: number | null = null;

	constructor(
		public getStore: () => FileTaskStore,
		private getMode: () => AutoClearMode,
		/** How many turns completed tasks linger before auto-clearing. */
		private clearDelayTurns = 4,
	) {}

	/** Record a task completion. Call after updating status. */
	trackCompletion(taskId: string, currentTurn: number): void {
		const mode = this.getMode();
		if (mode === "never") return;

		if (mode === "on_task_complete") {
			this.completedAtTurn.set(taskId, currentTurn);
		} else if (mode === "on_list_complete") {
			this.checkAllCompleted(currentTurn);
		}
	}

	private checkAllCompleted(currentTurn: number): void {
		const tasks = this.getStore().list();
		if (tasks.length > 0 && tasks.every((t) => t.status === "completed")) {
			if (this.allCompletedAtTurn === null) this.allCompletedAtTurn = currentTurn;
		} else {
			this.allCompletedAtTurn = null;
		}
	}

	/** Reset batch countdown (e.g., when a new task is created). */
	resetBatchCountdown(): void {
		this.allCompletedAtTurn = null;
	}

	/** Reset all tracking state (e.g., on new session). */
	reset(): void {
		this.completedAtTurn.clear();
		this.allCompletedAtTurn = null;
	}

	/**
	 * Called on each turn start. Deletes tasks whose linger period has expired.
	 * Returns true if any tasks were cleared.
	 */
	onTurnStart(currentTurn: number): boolean {
		const mode = this.getMode();
		let cleared = false;

		if (mode === "on_task_complete") {
			for (const [taskId, turn] of this.completedAtTurn) {
				const task = this.getStore().get(taskId);
				if (!task || task.status !== "completed") {
					this.completedAtTurn.delete(taskId);
				} else if (currentTurn - turn >= this.clearDelayTurns) {
					this.getStore().delete(taskId);
					this.completedAtTurn.delete(taskId);
					cleared = true;
				}
			}
		} else if (mode === "on_list_complete" && this.allCompletedAtTurn !== null) {
			if (currentTurn - this.allCompletedAtTurn >= this.clearDelayTurns) {
				this.getStore().clearCompleted();
				this.allCompletedAtTurn = null;
				cleared = true;
			}
		}

		return cleared;
	}
}
