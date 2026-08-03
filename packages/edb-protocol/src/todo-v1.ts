export const TODO_PROTOCOL_VERSION = 1 as const;
export const TODO_DISCOVER_EVENT = "edb:todo:v1:discover";
export const TODO_READY_EVENT = "edb:todo:v1:ready";

export const TODO_METHODS = [
	"capabilities",
	"create",
	"createMany",
	"list",
	"get",
	"update",
	"assign",
	"block",
	"unblock",
] as const;

export type TodoMethod = (typeof TODO_METHODS)[number];
export type OperationId = string;

export interface TodoActorV1 {
	agentId: string;
	runId: string | null;
}

export interface TodoRequestV1<M extends TodoMethod = TodoMethod> {
	protocolVersion: typeof TODO_PROTOCOL_VERSION;
	requestId: string;
	operationId?: OperationId;
	rootSessionId: string;
	instanceNonce: string;
	method: M;
	actor: TodoActorV1;
	params: TodoParams[M];
}

export interface TodoResponseV1 {
	protocolVersion: typeof TODO_PROTOCOL_VERSION;
	requestId: string;
	operationId?: OperationId;
	ok: boolean;
	result?: unknown;
	error?: {
		code: string;
		message: string;
		details?: unknown;
	};
}

export interface TodoTaskInputV1 {
	content: string;
	description?: string;
	priority?: "high" | "medium" | "low";
	activeForm?: string;
	parentId?: string;
	groupId?: string;
	metadata?: Record<string, unknown>;
}

export interface TodoTaskPatchV1 {
	status?: "pending" | "in_progress" | "completed" | "blocked" | "failed" | "cancelled" | "deleted";
	content?: string;
	description?: string;
	priority?: "high" | "medium" | "low";
	activeForm?: string;
	owner?: string;
	parentId?: string;
	groupId?: string;
	blockedByGroup?: string;
	blockQuestion?: string;
	blockMessageId?: string;
	metadata?: Record<string, unknown>;
	addBlocks?: string[];
	addBlockedBy?: string[];
}

export interface TodoParams {
	capabilities: Record<string, never>;
	create: TodoTaskInputV1;
	createMany: { tasks: TodoTaskInputV1[] };
	list: { status?: string; owner?: string };
	get: { taskId: string };
	update: { taskId: string; patch: TodoTaskPatchV1 };
	assign: { taskId: string; owner: { agentId: string; runId: string | null } };
	block: { taskId: string; question: { questionId: string; text: string } };
	unblock: { taskId: string; questionId: string };
}

export interface TodoReadyV1 {
	protocolVersion: typeof TODO_PROTOCOL_VERSION;
	rootSessionId: string;
	instanceNonce: string;
	methods: TodoMethod[];
}

export function todoRequestEvent(instanceNonce: string): string {
	return `edb:todo:v1:${instanceNonce}:request`;
}

export function todoResponseEvent(instanceNonce: string): string {
	return `edb:todo:v1:${instanceNonce}:response`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(record: Record<string, unknown>, key: string): boolean {
	return typeof record[key] === "string" && record[key].length > 0;
}

function validParams(method: TodoMethod, params: unknown): boolean {
	if (!isRecord(params)) return false;
	switch (method) {
		case "capabilities":
		case "list":
			return true;
		case "create":
			return hasString(params, "content");
		case "createMany":
			return (
				Array.isArray(params.tasks) &&
				params.tasks.length > 0 &&
				params.tasks.every((task) => isRecord(task) && hasString(task, "content"))
			);
		case "get":
			return hasString(params, "taskId");
		case "update":
			return hasString(params, "taskId") && isRecord(params.patch);
		case "assign":
			return hasString(params, "taskId") && isRecord(params.owner) && hasString(params.owner, "agentId");
		case "block":
			return (
				hasString(params, "taskId") &&
				isRecord(params.question) &&
				hasString(params.question, "questionId") &&
				hasString(params.question, "text")
			);
		case "unblock":
			return hasString(params, "taskId") && hasString(params, "questionId");
	}
}

export function validateTodoRequestV1(value: unknown): value is TodoRequestV1 {
	if (!isRecord(value) || value.protocolVersion !== TODO_PROTOCOL_VERSION) return false;
	if (!hasString(value, "requestId") || !hasString(value, "rootSessionId") || !hasString(value, "instanceNonce"))
		return false;
	if (value.operationId !== undefined && typeof value.operationId !== "string") return false;
	if (!TODO_METHODS.includes(value.method as TodoMethod) || !isRecord(value.actor)) return false;
	if (!hasString(value.actor, "agentId") || (value.actor.runId !== null && typeof value.actor.runId !== "string"))
		return false;
	return validParams(value.method as TodoMethod, value.params);
}

export function validateTodoResponseV1(value: unknown): value is TodoResponseV1 {
	if (!isRecord(value) || value.protocolVersion !== TODO_PROTOCOL_VERSION || !hasString(value, "requestId"))
		return false;
	if (typeof value.ok !== "boolean") return false;
	if (value.operationId !== undefined && typeof value.operationId !== "string") return false;
	if (!value.ok) {
		return isRecord(value.error) && hasString(value.error, "code") && hasString(value.error, "message");
	}
	return true;
}

export function validateTodoReadyV1(value: unknown): value is TodoReadyV1 {
	return (
		isRecord(value) &&
		value.protocolVersion === TODO_PROTOCOL_VERSION &&
		hasString(value, "rootSessionId") &&
		hasString(value, "instanceNonce") &&
		Array.isArray(value.methods) &&
		value.methods.every((method) => TODO_METHODS.includes(method as TodoMethod))
	);
}
