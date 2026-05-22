// ── Types ──────────────────────────────────────────────────────────────────────

export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "failed";
export type TaskPriority = "high" | "medium" | "low";

export interface Task {
	id: string;
	content: string; // main title / subject
	description?: string; // detailed description (optional)
	status: TaskStatus;
	priority: TaskPriority;
	activeForm?: string; // spinner text when in_progress (e.g. "Running tests")
	owner?: string; // agent name / owner — shown in widget only when set by a sub-agent
	parentId?: string; // parent task ID (for subtasks)
	groupId?: string; // parallel group ID — tasks in the same group run concurrently
	blockedByGroup?: string; // groupId to wait for — unblocks when all group tasks are completed
	blockQuestion?: string; // question text when status === "blocked" (waiting for supervisor answer)
	blockMessageId?: string; // bridge message ID for the pending ask (resolved by answer_subagent)
	metadata: Record<string, any>;
	blocks: string[]; // task IDs this task blocks
	blockedBy: string[]; // task IDs that block this task
	createdAt: number;
	updatedAt: number;
	startedAt?: number;
	completedAt?: number;
	blockedAt?: number; // when status changed to "blocked"
}

export interface TaskDetails {
	tasks: Task[];
}

/** Serialized store format on disk. */
export interface TaskStoreData {
	nextId: number;
	tasks: Task[];
}

// ── Visual constants ───────────────────────────────────────────────────────────

export const STATUS_ICON: Record<TaskStatus, string> = {
	pending: "○",
	in_progress: "●",
	completed: "✓",
	blocked: "⏸",
	failed: "✗",
};

export const PRIORITY_ORDER: Record<TaskPriority, number> = {
	high: 0,
	medium: 1,
	low: 2,
};
