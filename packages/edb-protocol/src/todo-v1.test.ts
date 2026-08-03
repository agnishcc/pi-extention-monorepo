import { describe, expect, it } from "vitest";
import { TODO_PROTOCOL_VERSION, todoRequestEvent, validateTodoRequestV1, validateTodoResponseV1 } from "./todo-v1.js";

describe("todo V1 protocol", () => {
	it("validates a correlated mutation request", () => {
		const request = {
			protocolVersion: TODO_PROTOCOL_VERSION,
			requestId: "req_1",
			operationId: "op_1",
			rootSessionId: "root_1",
			instanceNonce: "nonce_1",
			method: "assign",
			actor: { agentId: "agt_1", runId: "run_1" },
			params: { taskId: "t1", owner: { agentId: "agt_1", runId: "run_1" } },
		};
		expect(validateTodoRequestV1(request)).toBe(true);
		expect(todoRequestEvent(request.instanceNonce)).toBe("edb:todo:v1:nonce_1:request");
	});

	it("rejects malformed actor and method parameters", () => {
		expect(
			validateTodoRequestV1({
				protocolVersion: 1,
				requestId: "req_1",
				rootSessionId: "root_1",
				instanceNonce: "nonce_1",
				method: "get",
				actor: { agentId: "", runId: null },
				params: {},
			}),
		).toBe(false);
	});

	it("requires structured errors for unsuccessful responses", () => {
		expect(validateTodoResponseV1({ protocolVersion: 1, requestId: "req", ok: false })).toBe(false);
		expect(
			validateTodoResponseV1({
				protocolVersion: 1,
				requestId: "req",
				ok: false,
				error: { code: "INVALID", message: "bad request" },
			}),
		).toBe(true);
	});
});
