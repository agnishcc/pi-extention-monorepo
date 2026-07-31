import {
	TODO_DISCOVER_EVENT,
	TODO_PROTOCOL_VERSION,
	TODO_READY_EVENT,
	type TodoReadyV1,
	type TodoRequestV1,
	type TodoResponseV1,
	todoRequestEvent,
	todoResponseEvent,
	validateTodoRequestV1,
} from "@agnishc/edb-protocol";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TaskService } from "../task-service.js";

const MUTATING_METHODS = new Set(["create", "createMany", "update", "assign", "block", "unblock"]);
const MAX_REQUEST_BYTES = 256 * 1024;

function serializedBytes(value: unknown): number {
	try {
		return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

function failure(request: Partial<TodoRequestV1>, code: string, message: string, details?: unknown): TodoResponseV1 {
	return {
		protocolVersion: TODO_PROTOCOL_VERSION,
		requestId: request.requestId ?? "invalid",
		operationId: request.operationId,
		ok: false,
		error: { code, message, details },
	};
}

export class TodoRpcServer {
	private disposers: Array<() => void> = [];
	private disposed = false;

	constructor(
		private readonly pi: ExtensionAPI,
		private readonly service: TaskService,
		readonly capability: TodoReadyV1,
		private readonly onMutation?: () => void,
	) {}

	start(): void {
		if (this.disposed || this.disposers.length > 0) return;
		this.disposers.push(
			this.pi.events.on(TODO_DISCOVER_EVENT, (payload) => {
				const request = payload as { rootSessionId?: string } | undefined;
				if (!request?.rootSessionId || request.rootSessionId === this.capability.rootSessionId) this.emitReady();
			}),
		);
		this.disposers.push(
			this.pi.events.on(todoRequestEvent(this.capability.instanceNonce), (payload) => void this.handle(payload)),
		);
		this.emitReady();
	}

	emitReady(): void {
		if (!this.disposed) this.pi.events.emit(TODO_READY_EVENT, this.capability);
	}

	private async handle(payload: unknown): Promise<void> {
		let response: TodoResponseV1;
		if (serializedBytes(payload) > MAX_REQUEST_BYTES) {
			response = failure(
				(payload ?? {}) as Partial<TodoRequestV1>,
				"PAYLOAD_TOO_LARGE",
				"Todo request is too large",
			);
		} else if (!validateTodoRequestV1(payload)) {
			response = failure((payload ?? {}) as Partial<TodoRequestV1>, "INVALID_REQUEST", "Malformed todo V1 request");
		} else if (payload.rootSessionId !== this.capability.rootSessionId) {
			response = failure(payload, "WRONG_ROOT_SESSION", "Todo request belongs to a different root session");
		} else if (payload.instanceNonce !== this.capability.instanceNonce) {
			response = failure(payload, "WRONG_INSTANCE", "Todo request instance nonce is stale");
		} else if (MUTATING_METHODS.has(payload.method) && !payload.operationId) {
			response = failure(payload, "OPERATION_ID_REQUIRED", `Method ${payload.method} requires an operation ID`);
		} else {
			try {
				const result = await this.dispatch(payload);
				response = {
					protocolVersion: TODO_PROTOCOL_VERSION,
					requestId: payload.requestId,
					operationId: payload.operationId,
					ok: true,
					result,
				};
				if (MUTATING_METHODS.has(payload.method)) this.onMutation?.();
			} catch (error) {
				response = failure(
					payload,
					error instanceof Error ? error.name.toUpperCase() : "TODO_ERROR",
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		const nonce = validateTodoRequestV1(payload) ? payload.instanceNonce : this.capability.instanceNonce;
		this.pi.events.emit(todoResponseEvent(nonce), response);
	}

	private async dispatch(request: TodoRequestV1): Promise<unknown> {
		const options = { operationId: request.operationId };
		switch (request.method) {
			case "capabilities":
				return this.capability;
			case "create":
				return this.service.create(request.params as any, request.actor, options);
			case "createMany":
				return this.service.createMany((request.params as any).tasks, request.actor, options);
			case "list":
				return this.service.list(request.params as any, request.actor);
			case "get":
				return this.service.get((request.params as any).taskId, request.actor);
			case "update":
				return this.service.applyUpdate(
					(request.params as any).taskId,
					(request.params as any).patch,
					request.actor,
					options,
				);
			case "assign":
				return this.service.assign(
					(request.params as any).taskId,
					(request.params as any).owner,
					request.actor,
					options,
				);
			case "block":
				return this.service.block(
					(request.params as any).taskId,
					(request.params as any).question,
					request.actor,
					options,
				);
			case "unblock":
				return this.service.unblock(
					(request.params as any).taskId,
					(request.params as any).questionId,
					request.actor,
					options,
				);
		}
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		for (const dispose of this.disposers.splice(0)) dispose();
	}
}
