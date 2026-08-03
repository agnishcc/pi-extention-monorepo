/** File-backed task persistence with asynchronous inter-process locking. */

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import type { IdempotencyRecord, Task, TaskPriority, TaskStatus, TaskStoreData } from "./types.js";

const LOCK_RETRY_MS = 50;
const LOCK_MAX_RETRIES = 100;
const IDEMPOTENCY_LIMIT = 500;

export interface MutationIdentity {
	operationId: string;
	fingerprint: string;
}

export class TaskStoreCorruptionError extends Error {
	constructor(
		public readonly originalPath: string,
		public readonly preservedPath: string,
		options?: ErrorOptions,
	) {
		super(`Task store is corrupt; preserved at ${preservedPath}`, options);
		this.name = "TaskStoreCorruptionError";
	}
}

export class IdempotencyConflictError extends Error {
	constructor(public readonly operationId: string) {
		super(`Operation ${operationId} was already used with different parameters`);
		this.name = "IdempotencyConflictError";
	}
}

function cloneTask(task: Task): Task {
	return structuredClone(task);
}

function cloneResult<T>(value: T): T {
	return structuredClone(value);
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
	for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
		try {
			const handle = await open(lockPath, "wx");
			await handle.writeFile(`${process.pid}`);
			await handle.sync();
			await handle.close();
			return async () => {
				try {
					await unlink(lockPath);
				} catch (error: any) {
					if (error?.code !== "ENOENT") throw error;
				}
			};
		} catch (error: any) {
			if (error?.code !== "EEXIST") throw error;
			try {
				const pid = Number.parseInt(await readFile(lockPath, "utf8"), 10);
				if (pid && !isProcessRunning(pid)) {
					await unlink(lockPath);
					continue;
				}
			} catch (readError: any) {
				if (readError?.code === "ENOENT") continue;
			}
			await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
		}
	}
	throw new Error(`Failed to acquire lock: ${lockPath}`);
}

export interface TaskUpdateFields {
	status?: TaskStatus | "deleted";
	content?: string;
	description?: string;
	priority?: TaskPriority;
	activeForm?: string;
	owner?: string;
	parentId?: string;
	groupId?: string;
	blockedByGroup?: string;
	blockQuestion?: string;
	blockMessageId?: string;
	metadata?: Record<string, any>;
	addBlocks?: string[];
	addBlockedBy?: string[];
}

export interface CreateTaskOptions {
	description?: string;
	priority?: TaskPriority;
	activeForm?: string;
	owner?: string;
	parentId?: string;
	groupId?: string;
	metadata?: Record<string, any>;
}

export class FileTaskStore {
	private filePath: string | undefined;
	private lockPath: string | undefined;
	private nextId = 1;
	private tasks = new Map<string, Task>();
	private idempotency = new Map<string, IdempotencyRecord>();
	private mutationQueue: Promise<void> = Promise.resolve();

	constructor(filePath?: string) {
		if (!filePath) return;
		mkdirSync(dirname(filePath), { recursive: true });
		this.filePath = filePath;
		this.lockPath = `${filePath}.lock`;
		this.load();
	}

	get path(): string | undefined {
		return this.filePath;
	}

	reload(): void {
		this.load();
	}

	private load(): void {
		if (!this.filePath || !existsSync(this.filePath)) return;
		try {
			this.applyData(JSON.parse(readFileSync(this.filePath, "utf8")) as TaskStoreData);
		} catch (cause) {
			const preservedPath = `${this.filePath}.corrupt-${Date.now()}`;
			renameSync(this.filePath, preservedPath);
			throw new TaskStoreCorruptionError(this.filePath, preservedPath, { cause });
		}
	}

	private applyData(data: TaskStoreData): void {
		if (!data || !Array.isArray(data.tasks) || !Number.isInteger(data.nextId))
			throw new Error("Invalid task store schema");
		this.nextId = data.nextId;
		this.tasks.clear();
		for (const raw of data.tasks) {
			if (!raw || typeof raw.id !== "string" || typeof raw.content !== "string")
				throw new Error("Invalid task record");
			const task = cloneTask(raw);
			task.metadata ??= {};
			task.blocks ??= [];
			task.blockedBy ??= [];
			task.updatedAt ||= task.createdAt;
			this.tasks.set(task.id, task);
		}
		this.idempotency = new Map((data.idempotency ?? []).map((record) => [record.operationId, record]));
	}

	private data(): TaskStoreData {
		return {
			nextId: this.nextId,
			tasks: [...this.tasks.values()].map(cloneTask),
			idempotency: [...this.idempotency.values()].slice(-IDEMPOTENCY_LIMIT).map(cloneResult),
		};
	}

	private async save(): Promise<void> {
		if (!this.filePath) return;
		const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
		const payload = JSON.stringify(this.data(), null, 2);
		const handle = await open(temporaryPath, "w");
		try {
			await handle.writeFile(payload);
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(temporaryPath, this.filePath);
		try {
			const directory = await open(dirname(this.filePath), "r");
			try {
				await directory.sync();
			} finally {
				await directory.close();
			}
		} catch {
			// Directory fsync is unavailable on some platforms.
		}
	}

	private async transaction<T>(mutation: () => T, identity?: MutationIdentity): Promise<T> {
		let resolveResult!: (value: T | PromiseLike<T>) => void;
		let rejectResult!: (reason?: unknown) => void;
		const result = new Promise<T>((resolve, reject) => {
			resolveResult = resolve;
			rejectResult = reject;
		});
		const job = this.mutationQueue.then(async () => {
			let release = async () => {};
			try {
				release = this.lockPath ? await acquireLock(this.lockPath) : async () => {};
				if (this.filePath) this.load();
				if (identity) {
					const previous = this.idempotency.get(identity.operationId);
					if (previous) {
						if (previous.fingerprint !== identity.fingerprint)
							throw new IdempotencyConflictError(identity.operationId);
						resolveResult(cloneResult(previous.result as T));
						return;
					}
				}
				const before = this.data();
				try {
					const value = mutation();
					this.validateDependencies();
					if (identity) {
						this.idempotency.set(identity.operationId, {
							operationId: identity.operationId,
							fingerprint: identity.fingerprint,
							result: cloneResult(value),
							createdAt: Date.now(),
						});
						while (this.idempotency.size > IDEMPOTENCY_LIMIT) {
							this.idempotency.delete(this.idempotency.keys().next().value!);
						}
					}
					await this.save();
					resolveResult(cloneResult(value));
				} catch (error) {
					this.applyData(before);
					throw error;
				}
			} catch (error) {
				rejectResult(error);
			} finally {
				try {
					await release();
				} catch (error) {
					rejectResult(error);
				}
			}
		});
		this.mutationQueue = job.catch(() => {});
		return result;
	}

	private validateDependencies(): void {
		for (const task of this.tasks.values()) {
			for (const targetId of task.blocks) {
				if (targetId === task.id) throw new Error(`#${task.id} cannot block itself`);
				if (!this.tasks.has(targetId)) throw new Error(`#${targetId} does not exist`);
			}
			for (const blockerId of task.blockedBy) {
				if (blockerId === task.id) throw new Error(`#${task.id} cannot be blocked by itself`);
				if (!this.tasks.has(blockerId)) throw new Error(`#${blockerId} does not exist`);
			}
		}
		const visiting = new Set<string>();
		const visited = new Set<string>();
		const visit = (id: string) => {
			if (visiting.has(id)) throw new Error(`Dependency cycle includes #${id}`);
			if (visited.has(id)) return;
			visiting.add(id);
			for (const target of this.tasks.get(id)?.blocks ?? []) visit(target);
			visiting.delete(id);
			visited.add(id);
		};
		for (const id of this.tasks.keys()) visit(id);
	}

	isGroupComplete(groupId: string): boolean {
		const groupTasks = [...this.tasks.values()].filter((task) => task.groupId === groupId);
		return groupTasks.length === 0 || groupTasks.every((task) => task.status === "completed");
	}

	getReadyTasks(): Task[] {
		return this.list().filter((task) => {
			if (task.status !== "pending") return false;
			if (task.blockedBy.some((id) => this.tasks.get(id)?.status !== "completed")) return false;
			return !task.blockedByGroup || this.isGroupComplete(task.blockedByGroup);
		});
	}

	syncIdCounter(): void {
		for (const task of this.tasks.values()) {
			const match = task.id.match(/^t(\d+)$/);
			if (match) this.nextId = Math.max(this.nextId, Number.parseInt(match[1]!, 10) + 1);
		}
	}

	generateId(): string {
		return `t${this.nextId++}`;
	}

	async create(content: string, options?: CreateTaskOptions, identity?: MutationIdentity): Promise<Task> {
		return this.transaction(() => this.createUnlocked(content, options), identity);
	}

	async createMany(
		items: Array<{ content: string; options?: CreateTaskOptions }>,
		identity?: MutationIdentity,
	): Promise<Task[]> {
		return this.transaction(() => items.map((item) => this.createUnlocked(item.content, item.options)), identity);
	}

	private createUnlocked(content: string, options?: CreateTaskOptions): Task {
		const now = Date.now();
		if (options?.parentId && !this.tasks.has(options.parentId))
			throw new Error(`Parent task #${options.parentId} does not exist`);
		const task: Task = {
			id: `t${this.nextId++}`,
			content,
			description: options?.description,
			status: "pending",
			priority: options?.priority ?? "medium",
			activeForm: options?.activeForm,
			owner: options?.owner,
			parentId: options?.parentId,
			groupId: options?.groupId,
			metadata: options?.metadata ?? {},
			blocks: [],
			blockedBy: [],
			createdAt: now,
			updatedAt: now,
		};
		this.tasks.set(task.id, task);
		return task;
	}

	get(id: string): Task | undefined {
		if (this.filePath) this.load();
		const task = this.tasks.get(id);
		return task ? cloneTask(task) : undefined;
	}

	list(): Task[] {
		if (this.filePath) this.load();
		return [...this.tasks.values()].map(cloneTask);
	}

	activeTasks(): Task[] {
		return this.list().filter((task) => task.status !== "completed" && task.status !== "cancelled");
	}

	async setTasks(tasks: Task[], identity?: MutationIdentity): Promise<void> {
		await this.transaction(() => {
			this.tasks = new Map(tasks.map((task) => [task.id, cloneTask(task)]));
			this.syncIdCounter();
		}, identity);
	}

	async update(
		id: string,
		fields: TaskUpdateFields,
		identity?: MutationIdentity,
	): Promise<{ task: Task | undefined; changedFields: string[]; warnings: string[] }> {
		return this.transaction(() => this.updateUnlocked(id, fields), identity);
	}

	private updateUnlocked(
		id: string,
		fields: TaskUpdateFields,
	): { task: Task | undefined; changedFields: string[]; warnings: string[] } {
		const task = this.tasks.get(id);
		if (!task) return { task: undefined, changedFields: [], warnings: [] };
		if (fields.status === "deleted") {
			this.deleteUnlocked(id);
			return { task: undefined, changedFields: ["deleted"], warnings: [] };
		}
		const changedFields: string[] = [];
		const warnings: string[] = [];
		const now = Date.now();
		if (fields.status !== undefined) {
			if (fields.status === "in_progress" && task.blockedByGroup && !this.isGroupComplete(task.blockedByGroup)) {
				return {
					task: cloneTask(task),
					changedFields,
					warnings: [`Task is waiting for group ${task.blockedByGroup}`],
				};
			}
			if (task.status !== "in_progress" && fields.status === "in_progress") task.startedAt = now;
			if (task.status !== "completed" && fields.status === "completed") {
				task.startedAt ??= now;
				task.completedAt = now;
			}
			if (fields.status !== "completed") task.completedAt = undefined;
			if (fields.status === "blocked") task.blockedAt = now;
			else if (task.status === "blocked") {
				task.blockedAt = undefined;
				if (fields.blockQuestion === undefined) task.blockQuestion = undefined;
				if (fields.blockMessageId === undefined) task.blockMessageId = undefined;
			}
			task.status = fields.status;
			changedFields.push("status");
		}
		for (const key of [
			"content",
			"description",
			"priority",
			"activeForm",
			"owner",
			"parentId",
			"groupId",
			"blockedByGroup",
			"blockQuestion",
			"blockMessageId",
		] as const) {
			if (fields[key] !== undefined) {
				(task as any)[key] = fields[key];
				changedFields.push(key);
			}
		}
		if (fields.parentId === id) throw new Error(`#${id} cannot be its own parent`);
		if (fields.parentId && !this.tasks.has(fields.parentId))
			throw new Error(`Parent task #${fields.parentId} does not exist`);
		if (fields.metadata) {
			for (const [key, value] of Object.entries(fields.metadata)) {
				if (value === null) delete task.metadata[key];
				else task.metadata[key] = value;
			}
			changedFields.push("metadata");
		}
		for (const targetId of fields.addBlocks ?? []) this.addEdge(id, targetId);
		for (const blockerId of fields.addBlockedBy ?? []) this.addEdge(blockerId, id);
		if (fields.addBlocks?.length) changedFields.push("blocks");
		if (fields.addBlockedBy?.length) changedFields.push("blockedBy");
		task.updatedAt = now;
		return { task: cloneTask(task), changedFields, warnings };
	}

	private addEdge(blockerId: string, blockedId: string): void {
		if (blockerId === blockedId) throw new Error(`#${blockerId} cannot block itself`);
		const blocker = this.tasks.get(blockerId);
		const blocked = this.tasks.get(blockedId);
		if (!blocker) throw new Error(`#${blockerId} does not exist`);
		if (!blocked) throw new Error(`#${blockedId} does not exist`);
		if (!blocker.blocks.includes(blockedId)) blocker.blocks.push(blockedId);
		if (!blocked.blockedBy.includes(blockerId)) blocked.blockedBy.push(blockerId);
	}

	async delete(id: string, identity?: MutationIdentity): Promise<boolean> {
		return this.transaction(() => this.deleteUnlocked(id), identity);
	}

	private deleteUnlocked(id: string): boolean {
		if (!this.tasks.delete(id)) return false;
		for (const task of this.tasks.values()) {
			task.blocks = task.blocks.filter((other) => other !== id);
			task.blockedBy = task.blockedBy.filter((other) => other !== id);
		}
		return true;
	}

	async removeByIds(ids: string[], identity?: MutationIdentity): Promise<string[]> {
		return this.transaction(() => ids.filter((id) => this.deleteUnlocked(id)), identity);
	}

	async clearAll(identity?: MutationIdentity): Promise<number> {
		return this.transaction(() => {
			const count = this.tasks.size;
			this.tasks.clear();
			return count;
		}, identity);
	}

	async clearCompleted(identity?: MutationIdentity): Promise<number> {
		return this.transaction(() => {
			const ids = [...this.tasks.values()].filter((task) => task.status === "completed").map((task) => task.id);
			for (const id of ids) this.deleteUnlocked(id);
			return ids.length;
		}, identity);
	}

	deleteFileIfEmpty(): boolean {
		if (!this.filePath || this.tasks.size > 0) return false;
		try {
			unlinkSync(this.filePath);
		} catch (error: any) {
			if (error?.code !== "ENOENT") throw error;
		}
		return true;
	}

	async applyStatusTransitions(updated: Task[]): Promise<void> {
		const existing = new Map(this.tasks);
		const now = Date.now();
		for (const task of updated) {
			const previous = existing.get(task.id);
			if (!previous) continue;
			task.createdAt = previous.createdAt;
			task.updatedAt = now;
			task.startedAt = previous.startedAt;
			task.completedAt = previous.completedAt;
			if (previous.status !== "in_progress" && task.status === "in_progress") task.startedAt = now;
			if (previous.status !== "completed" && task.status === "completed") task.completedAt = now;
			if (task.status !== "completed") task.completedAt = undefined;
		}
		await this.setTasks(updated);
	}

	async cleanup(): Promise<void> {
		await this.mutationQueue;
		if (!this.lockPath || !existsSync(this.lockPath)) return;
		try {
			const pid = Number.parseInt(readFileSync(this.lockPath, "utf8"), 10);
			if (pid === process.pid) unlinkSync(this.lockPath);
		} catch {
			// Best-effort cleanup only.
		}
	}
}
