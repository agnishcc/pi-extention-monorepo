import { randomUUID } from "node:crypto";
import {
	TODO_DISCOVER_EVENT,
	TODO_READY_EVENT,
	type TodoMethod,
	type TodoParams,
	type TodoReadyV1,
	type TodoRequestV1,
	todoRequestEvent,
	todoResponseEvent,
	validateTodoReadyV1,
	validateTodoResponseV1,
} from "@agnishc/edb-protocol";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface PendingRequest {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: ReturnType<typeof setTimeout>;
}

export class TodoClient {
	private capability: TodoReadyV1 | undefined;
	private rootSessionId = "";
	private disposers: Array<() => void> = [];
	private responseDisposer: (() => void) | undefined;
	private pending = new Map<string, PendingRequest>();

	constructor(
		private readonly pi: ExtensionAPI,
		private readonly timeoutMs = 1_000,
		private readonly onAvailable?: () => void,
	) {}

	start(rootSessionId: string): void {
		this.rootSessionId = rootSessionId;
		this.disposers.push(
			this.pi.events.on(TODO_READY_EVENT, (payload) => {
				if (!validateTodoReadyV1(payload) || payload.rootSessionId !== this.rootSessionId) return;
				this.bindCapability(payload);
			}),
		);
		this.pi.events.emit(TODO_DISCOVER_EVENT, { rootSessionId });
	}

	get available(): boolean {
		return this.capability !== undefined;
	}

	get methods(): readonly TodoMethod[] {
		return this.capability?.methods ?? [];
	}

	private bindCapability(capability: TodoReadyV1): void {
		if (this.capability?.instanceNonce === capability.instanceNonce) return;
		this.responseDisposer?.();
		this.capability = capability;
		this.responseDisposer = this.pi.events.on(todoResponseEvent(capability.instanceNonce), (payload) =>
			this.receive(payload),
		);
		this.onAvailable?.();
	}

	private receive(payload: unknown): void {
		if (!validateTodoResponseV1(payload)) return;
		const pending = this.pending.get(payload.requestId);
		if (!pending) return;
		clearTimeout(pending.timer);
		this.pending.delete(payload.requestId);
		if (payload.ok) pending.resolve(payload.result);
		else pending.reject(Object.assign(new Error(payload.error!.message), { code: payload.error!.code }));
	}

	async request<M extends TodoMethod>(
		method: M,
		params: TodoParams[M],
		actor: { agentId: string; runId: string | null },
		operationId?: string,
	): Promise<unknown> {
		const capability = this.capability;
		if (!capability) throw new Error("Todo V1 service is unavailable");
		if (!capability.methods.includes(method)) throw new Error(`Todo V1 service does not support ${method}`);
		const requestId = `req_${randomUUID()}`;
		const request: TodoRequestV1<M> = {
			protocolVersion: 1,
			requestId,
			operationId,
			rootSessionId: this.rootSessionId,
			instanceNonce: capability.instanceNonce,
			method,
			actor,
			params,
		};
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(requestId);
				reject(new Error(`Todo V1 ${method} request timed out`));
			}, this.timeoutMs);
			this.pending.set(requestId, { resolve, reject, timer });
			this.pi.events.emit(todoRequestEvent(capability.instanceNonce), request);
		});
	}

	dispose(): void {
		this.responseDisposer?.();
		this.responseDisposer = undefined;
		for (const dispose of this.disposers.splice(0)) dispose();
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error("Todo client disposed"));
		}
		this.pending.clear();
		this.capability = undefined;
	}
}
