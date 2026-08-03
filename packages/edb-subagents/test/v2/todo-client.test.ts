import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { FileTaskStore } from "../../../edb-todo/src/file-store.js";
import { createTodoCapability } from "../../../edb-todo/src/rpc/capability.js";
import { TodoRpcServer } from "../../../edb-todo/src/rpc/server.js";
import { TaskService } from "../../../edb-todo/src/task-service.js";
import { TodoClient } from "../../src/v2/integrations/todo-client.js";

class TestBus {
	private handlers = new Map<string, Set<(value: unknown) => void>>();
	emit(channel: string, value: unknown): void {
		for (const handler of this.handlers.get(channel) ?? []) handler(value);
	}
	on(channel: string, handler: (value: unknown) => void): () => void {
		const handlers = this.handlers.get(channel) ?? new Set();
		handlers.add(handler);
		this.handlers.set(channel, handlers);
		return () => handlers.delete(handler);
	}
}

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("TodoClient and TodoRpcServer", () => {
	it("discovers a versioned instance and replays mutations idempotently", async () => {
		const directory = await mkdtemp(join(tmpdir(), "edb-todo-rpc-"));
		directories.push(directory);
		const events = new TestBus();
		const pi = { events } as unknown as ExtensionAPI;
		const service = new TaskService(new FileTaskStore(join(directory, "tasks.json")));
		let server = new TodoRpcServer(pi, service, createTodoCapability("root_rpc"));
		let availabilityEvents = 0;
		const client = new TodoClient(pi, 500, () => availabilityEvents++);
		client.start("root_rpc");
		server.start();
		expect(client.available).toBe(true);
		expect(availabilityEvents).toBe(1);
		const actor = { agentId: "agt_test", runId: "run_test" };
		const first = await client.request("create", { content: "RPC task" }, actor, "op_rpc_create");
		const replay = await client.request("create", { content: "RPC task" }, actor, "op_rpc_create");
		expect(replay).toEqual(first);
		expect(await service.list({}, actor)).toHaveLength(1);
		server.dispose();
		server = new TodoRpcServer(pi, service, createTodoCapability("root_rpc"));
		server.start();
		expect(availabilityEvents).toBe(2);
		expect(await client.request("list", {}, actor)).toHaveLength(1);
		client.dispose();
		server.dispose();
	});

	it("rejects cross-root discovery", async () => {
		const directory = await mkdtemp(join(tmpdir(), "edb-todo-rpc-"));
		directories.push(directory);
		const events = new TestBus();
		const pi = { events } as unknown as ExtensionAPI;
		const server = new TodoRpcServer(
			pi,
			new TaskService(new FileTaskStore(join(directory, "tasks.json"))),
			createTodoCapability("root_server"),
		);
		const client = new TodoClient(pi, 50);
		client.start("root_other");
		server.start();
		expect(client.available).toBe(false);
		client.dispose();
		server.dispose();
	});
});
