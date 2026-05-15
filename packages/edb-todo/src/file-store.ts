/**
 * file-store.ts — File-backed task store with CRUD, dependency management, and file locking.
 *
 * memory (no path): in-memory only.
 * session / project: file-backed with atomic writes and file locking.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Task, TaskPriority, TaskStatus, TaskStoreData } from "./types.js";

const LOCK_RETRY_MS = 50;
const LOCK_MAX_RETRIES = 100; // 5s max

function acquireLock(lockPath: string): void {
	for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
		try {
			writeFileSync(lockPath, `${process.pid}`, { flag: "wx" });
			return;
		} catch (e: any) {
			if (e.code === "EEXIST") {
				try {
					const pid = parseInt(readFileSync(lockPath, "utf-8"), 10);
					if (pid && !isProcessRunning(pid)) {
						unlinkSync(lockPath);
						continue;
					}
				} catch {
					/* ignore */
				}
				const start = Date.now();
				while (Date.now() - start < LOCK_RETRY_MS) {
					/* busy wait */
				}
				continue;
			}
			throw e;
		}
	}
	throw new Error(`Failed to acquire lock: ${lockPath}`);
}

function releaseLock(lockPath: string): void {
	try {
		unlinkSync(lockPath);
	} catch {
		/* ignore */
	}
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

// ── FileTaskStore ──────────────────────────────────────────────────────────────

export class FileTaskStore {
	private filePath: string | undefined;
	private lockPath: string | undefined;

	private nextId = 1;
	private tasks = new Map<string, Task>();

	constructor(filePath?: string) {
		if (!filePath) return;
		mkdirSync(dirname(filePath), { recursive: true });
		this.filePath = filePath;
		this.lockPath = `${filePath}.lock`;
		this.load();
	}

	private load(): void {
		if (!this.filePath) return;
		if (!existsSync(this.filePath)) return;
		try {
			const data: TaskStoreData = JSON.parse(readFileSync(this.filePath, "utf-8"));
			this.nextId = data.nextId ?? 1;
			this.tasks.clear();
			for (const t of data.tasks) {
				// Migrate old tasks that lack new fields
				if (!t.metadata) t.metadata = {};
				if (!t.blocks) t.blocks = [];
				if (!t.blockedBy) t.blockedBy = [];
				if (!t.updatedAt) t.updatedAt = t.createdAt;
				this.tasks.set(t.id, t);
			}
		} catch {
			/* corrupt file — start fresh */
		}
	}

	private save(): void {
		if (!this.filePath) return;
		const data: TaskStoreData = {
			nextId: this.nextId,
			tasks: Array.from(this.tasks.values()),
		};
		const tmpPath = `${this.filePath}.tmp`;
		writeFileSync(tmpPath, JSON.stringify(data, null, 2));
		renameSync(tmpPath, this.filePath);
	}

	private withLock<T>(fn: () => T): T {
		if (!this.lockPath) return fn();
		acquireLock(this.lockPath);
		try {
			this.load();
			const result = fn();
			this.save();
			return result;
		} finally {
			releaseLock(this.lockPath);
		}
	}

	// ── Sync ID counter after external writes ────────────────────────────────

	syncIdCounter(): void {
		for (const t of this.tasks.values()) {
			const m = t.id.match(/^t(\d+)$/);
			if (m) this.nextId = Math.max(this.nextId, parseInt(m[1]!, 10) + 1);
			const n = parseInt(t.id, 10);
			if (!Number.isNaN(n)) this.nextId = Math.max(this.nextId, n + 1);
		}
	}

	generateId(): string {
		return `t${this.nextId++}`;
	}

	// ── CRUD ──────────────────────────────────────────────────────────────────

	create(
		content: string,
		opts?: {
			description?: string;
			priority?: TaskPriority;
			activeForm?: string;
			metadata?: Record<string, any>;
		},
	): Task {
		return this.withLock(() => {
			const now = Date.now();
			const task: Task = {
				id: `t${this.nextId++}`,
				content,
				description: opts?.description,
				status: "pending",
				priority: opts?.priority ?? "medium",
				activeForm: opts?.activeForm,
				owner: undefined,
				metadata: opts?.metadata ?? {},
				blocks: [],
				blockedBy: [],
				createdAt: now,
				updatedAt: now,
			};
			this.tasks.set(task.id, task);
			return task;
		});
	}

	get(id: string): Task | undefined {
		if (this.filePath) this.load();
		return this.tasks.get(id);
	}

	list(): Task[] {
		if (this.filePath) this.load();
		return Array.from(this.tasks.values());
	}

	activeTasks(): Task[] {
		return this.list().filter((t) => t.status !== "completed");
	}

	/** Replace entire task list. */
	setTasks(tasks: Task[]): void {
		this.withLock(() => {
			this.tasks.clear();
			for (const t of tasks) {
				this.tasks.set(t.id, t);
			}
		});
	}

	update(
		id: string,
		fields: {
			status?: TaskStatus | "deleted";
			content?: string;
			description?: string;
			priority?: TaskPriority;
			activeForm?: string;
			owner?: string;
			metadata?: Record<string, any>;
			addBlocks?: string[];
			addBlockedBy?: string[];
		},
	): { task: Task | undefined; changedFields: string[]; warnings: string[] } {
		return this.withLock(() => {
			const task = this.tasks.get(id);
			if (!task) return { task: undefined, changedFields: [], warnings: [] };

			const changedFields: string[] = [];
			const warnings: string[] = [];

			if (fields.status === "deleted") {
				this.tasks.delete(id);
				// Clean up edges
				for (const t of this.tasks.values()) {
					t.blocks = t.blocks.filter((bid) => bid !== id);
					t.blockedBy = t.blockedBy.filter((bid) => bid !== id);
				}
				return { task: undefined, changedFields: ["deleted"], warnings: [] };
			}

			const now = Date.now();

			if (fields.status !== undefined) {
				// Timestamp transitions
				if (task.status !== "in_progress" && fields.status === "in_progress") task.startedAt = now;
				if (task.status !== "completed" && fields.status === "completed") {
					task.startedAt = task.startedAt ?? now;
					task.completedAt = now;
				}
				if (task.status === "completed" && fields.status !== "completed") {
					task.completedAt = undefined;
				}
				task.status = fields.status;
				changedFields.push("status");
			}
			if (fields.content !== undefined) {
				task.content = fields.content;
				changedFields.push("content");
			}
			if (fields.description !== undefined) {
				task.description = fields.description;
				changedFields.push("description");
			}
			if (fields.priority !== undefined) {
				task.priority = fields.priority;
				changedFields.push("priority");
			}
			if (fields.activeForm !== undefined) {
				task.activeForm = fields.activeForm;
				changedFields.push("activeForm");
			}
			if (fields.owner !== undefined) {
				task.owner = fields.owner;
				changedFields.push("owner");
			}

			if (fields.metadata !== undefined) {
				for (const [key, value] of Object.entries(fields.metadata)) {
					if (value === null) delete task.metadata[key];
					else task.metadata[key] = value;
				}
				changedFields.push("metadata");
			}

			if (fields.addBlocks && fields.addBlocks.length > 0) {
				for (const targetId of fields.addBlocks) {
					if (!task.blocks.includes(targetId)) task.blocks.push(targetId);
					const target = this.tasks.get(targetId);
					if (target && !target.blockedBy.includes(id)) {
						target.blockedBy.push(id);
						target.updatedAt = now;
					}
					if (targetId === id) warnings.push(`#${id} blocks itself`);
					else if (!target) warnings.push(`#${targetId} does not exist`);
					else if (target.blocks.includes(id)) warnings.push(`cycle: #${id} and #${targetId} block each other`);
				}
				changedFields.push("blocks");
			}

			if (fields.addBlockedBy && fields.addBlockedBy.length > 0) {
				for (const targetId of fields.addBlockedBy) {
					if (!task.blockedBy.includes(targetId)) task.blockedBy.push(targetId);
					const target = this.tasks.get(targetId);
					if (target && !target.blocks.includes(id)) {
						target.blocks.push(id);
						target.updatedAt = now;
					}
					if (targetId === id) warnings.push(`#${id} blocks itself`);
					else if (!target) warnings.push(`#${targetId} does not exist`);
					else if (task.blocks.includes(targetId))
						warnings.push(`cycle: #${id} and #${targetId} block each other`);
				}
				changedFields.push("blockedBy");
			}

			task.updatedAt = now;
			return { task, changedFields, warnings };
		});
	}

	delete(id: string): boolean {
		return this.withLock(() => {
			if (!this.tasks.has(id)) return false;
			this.tasks.delete(id);
			for (const t of this.tasks.values()) {
				t.blocks = t.blocks.filter((bid) => bid !== id);
				t.blockedBy = t.blockedBy.filter((bid) => bid !== id);
			}
			return true;
		});
	}

	removeByIds(ids: string[]): string[] {
		return this.withLock(() => {
			const removed: string[] = [];
			for (const id of ids) {
				if (this.tasks.has(id)) {
					this.tasks.delete(id);
					removed.push(id);
				}
			}
			// Clean up edges
			if (removed.length > 0) {
				const removedSet = new Set(removed);
				for (const t of this.tasks.values()) {
					t.blocks = t.blocks.filter((bid) => !removedSet.has(bid));
					t.blockedBy = t.blockedBy.filter((bid) => !removedSet.has(bid));
				}
			}
			return removed;
		});
	}

	clearAll(): number {
		return this.withLock(() => {
			const count = this.tasks.size;
			this.tasks.clear();
			return count;
		});
	}

	clearCompleted(): number {
		return this.withLock(() => {
			let count = 0;
			const toDelete: string[] = [];
			for (const [id, task] of this.tasks) {
				if (task.status === "completed") {
					toDelete.push(id);
					count++;
				}
			}
			for (const id of toDelete) this.tasks.delete(id);
			if (count > 0) {
				const validIds = new Set(this.tasks.keys());
				for (const t of this.tasks.values()) {
					t.blocks = t.blocks.filter((bid) => validIds.has(bid));
					t.blockedBy = t.blockedBy.filter((bid) => validIds.has(bid));
				}
			}
			return count;
		});
	}

	deleteFileIfEmpty(): boolean {
		if (!this.filePath || this.tasks.size > 0) return false;
		try {
			unlinkSync(this.filePath);
		} catch {
			/* ignore */
		}
		return true;
	}

	/** Apply status transitions and timestamps for bulk writes. */
	applyStatusTransitions(updated: Task[]): void {
		const now = Date.now();
		const existing = new Map(this.tasks);
		for (const task of updated) {
			const prev = existing.get(task.id);
			if (!prev) {
				task.createdAt = task.createdAt ?? now;
				task.updatedAt = now;
				if (task.status === "in_progress") task.startedAt = now;
				if (task.status === "completed") {
					task.startedAt = task.startedAt ?? now;
					task.completedAt = now;
				}
				continue;
			}
			task.createdAt = prev.createdAt;
			task.startedAt = prev.startedAt;
			task.completedAt = prev.completedAt;
			task.blocks = task.blocks?.length ? task.blocks : prev.blocks;
			task.blockedBy = task.blockedBy?.length ? task.blockedBy : prev.blockedBy;
			task.metadata = task.metadata && Object.keys(task.metadata).length ? task.metadata : prev.metadata;
			task.updatedAt = now;

			if (prev.status !== "in_progress" && task.status === "in_progress") task.startedAt = now;
			if (prev.status !== "completed" && task.status === "completed") {
				task.startedAt = task.startedAt ?? now;
				task.completedAt = now;
			}
			if (prev.status === "completed" && task.status !== "completed") task.completedAt = undefined;
		}
	}
}
