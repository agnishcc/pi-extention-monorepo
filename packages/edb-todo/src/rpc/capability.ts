import { randomUUID } from "node:crypto";
import { TODO_METHODS, TODO_PROTOCOL_VERSION, type TodoReadyV1 } from "@agnishc/edb-protocol";

export function createTodoCapability(rootSessionId: string): TodoReadyV1 {
	return {
		protocolVersion: TODO_PROTOCOL_VERSION,
		rootSessionId,
		instanceNonce: randomUUID(),
		methods: [...TODO_METHODS],
	};
}
