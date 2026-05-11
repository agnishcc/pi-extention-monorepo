// ── Types ──────────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "in_progress" | "completed";
export type TaskPriority = "high" | "medium" | "low";

export interface Task {
	id: string;
	content: string;
	status: TaskStatus;
	priority: TaskPriority;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
}

export interface TaskDetails {
	tasks: Task[];
}

// ── Visual constants ───────────────────────────────────────────────────────────

export const STATUS_ICON: Record<TaskStatus, string> = {
	pending: "○",
	in_progress: "●",
	completed: "✓",
};

export const PRIORITY_ORDER: Record<TaskPriority, number> = {
	high: 0,
	medium: 1,
	low: 2,
};
