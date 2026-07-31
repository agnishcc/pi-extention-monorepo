import type { OperationId, TodoActorV1, TodoTaskInputV1, TodoTaskPatchV1 } from "@agnishc/edb-protocol";
import type { FileTaskStore, MutationIdentity, TaskUpdateFields } from "./file-store.js";
import type { Task, TaskPriority, TaskStatus } from "./types.js";

export type TaskActor = TodoActorV1;
export type CreateTaskInput = TodoTaskInputV1;
export type TaskPatch = TodoTaskPatchV1;
export interface TaskQuery {
	status?: string;
	owner?: string;
}

export interface TaskOwner {
	agentId: string;
	runId: string | null;
}

export interface TaskQuestionLink {
	questionId: string;
	text: string;
}

export interface MutationOptions {
	operationId?: OperationId;
}

function stable(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, nested]) => `${JSON.stringify(key)}:${stable(nested)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function identity(
	method: string,
	params: unknown,
	actor: TaskActor,
	options?: MutationOptions,
): MutationIdentity | undefined {
	if (!options?.operationId) return undefined;
	return { operationId: options.operationId, fingerprint: stable({ method, params, actor }) };
}

function createOptions(input: CreateTaskInput) {
	return {
		description: input.description,
		priority: input.priority as TaskPriority | undefined,
		activeForm: input.activeForm,
		parentId: input.parentId,
		groupId: input.groupId,
		metadata: input.metadata,
	};
}

export class TaskService {
	constructor(public readonly store: FileTaskStore) {}

	async create(input: CreateTaskInput, actor: TaskActor, options?: MutationOptions): Promise<Task> {
		if (!input.content.trim()) throw new Error("Task content is required");
		return this.store.create(input.content.trim(), createOptions(input), identity("create", input, actor, options));
	}

	async createMany(inputs: CreateTaskInput[], actor: TaskActor, options?: MutationOptions): Promise<Task[]> {
		if (inputs.length === 0) throw new Error("At least one task is required");
		if (inputs.some((input) => !input.content.trim())) throw new Error("Task content is required");
		return this.store.createMany(
			inputs.map((input) => ({ content: input.content.trim(), options: createOptions(input) })),
			identity("createMany", inputs, actor, options),
		);
	}

	async list(query: TaskQuery, _actor: TaskActor): Promise<Task[]> {
		return this.store
			.list()
			.filter((task) => !query.status || task.status === query.status)
			.filter((task) => !query.owner || task.owner === query.owner);
	}

	async get(taskId: string, _actor: TaskActor): Promise<Task | undefined> {
		return this.store.get(taskId);
	}

	async update(taskId: string, patch: TaskPatch, actor: TaskActor, options?: MutationOptions): Promise<Task> {
		const result = await this.applyUpdate(taskId, patch as TaskUpdateFields, actor, options);
		if (!result.task && !result.changedFields.includes("deleted")) throw new Error(`Task #${taskId} not found`);
		if (result.warnings.length > 0) throw new Error(result.warnings.join("; "));
		if (!result.task) throw new Error(`Task #${taskId} was deleted`);
		return result.task;
	}

	async applyUpdate(taskId: string, patch: TaskUpdateFields, actor: TaskActor, options?: MutationOptions) {
		return this.store.update(taskId, patch, identity("update", { taskId, patch }, actor, options));
	}

	async assign(taskId: string, owner: TaskOwner, actor: TaskActor, options?: MutationOptions): Promise<Task> {
		const patch: TaskUpdateFields = {
			owner: owner.agentId,
			status: "in_progress",
			metadata: { ownerRunId: owner.runId },
		};
		const result = await this.store.update(taskId, patch, identity("assign", { taskId, owner }, actor, options));
		if (!result.task) throw new Error(`Task #${taskId} not found`);
		if (result.warnings.length > 0) throw new Error(result.warnings.join("; "));
		return result.task;
	}

	async block(taskId: string, question: TaskQuestionLink, actor: TaskActor, options?: MutationOptions): Promise<Task> {
		const result = await this.store.update(
			taskId,
			{ status: "blocked", blockQuestion: question.text, blockMessageId: question.questionId },
			identity("block", { taskId, question }, actor, options),
		);
		if (!result.task) throw new Error(`Task #${taskId} not found`);
		return result.task;
	}

	async unblock(taskId: string, questionId: string, actor: TaskActor, options?: MutationOptions): Promise<Task> {
		const current = this.store.get(taskId);
		if (!current) throw new Error(`Task #${taskId} not found`);
		if (current.blockMessageId !== questionId)
			throw new Error(`Question ${questionId} does not block task #${taskId}`);
		const result = await this.store.update(
			taskId,
			{ status: "in_progress", blockQuestion: "", blockMessageId: "" },
			identity("unblock", { taskId, questionId }, actor, options),
		);
		if (!result.task) throw new Error(`Task #${taskId} not found`);
		return result.task;
	}

	async transition(
		taskId: string,
		status: Extract<TaskStatus, "in_progress" | "completed" | "failed" | "cancelled">,
		actor: TaskActor,
		options?: MutationOptions,
	): Promise<Task> {
		return this.update(taskId, { status }, actor, options);
	}

	async delete(taskId: string, actor: TaskActor, options?: MutationOptions): Promise<boolean> {
		return this.store.delete(taskId, identity("delete", { taskId }, actor, options));
	}

	async clearCompleted(actor: TaskActor, options?: MutationOptions): Promise<number> {
		return this.store.clearCompleted(identity("clearCompleted", {}, actor, options));
	}

	async clearAll(actor: TaskActor, options?: MutationOptions): Promise<number> {
		return this.store.clearAll(identity("clearAll", {}, actor, options));
	}
}
