import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileTaskStore, IdempotencyConflictError, TaskStoreCorruptionError } from "./file-store.js";
import { TaskService } from "./task-service.js";

const directories: string[] = [];
const actor = { agentId: "root", runId: null };

afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function harness() {
	const directory = await mkdtemp(join(tmpdir(), "edb-todo-"));
	directories.push(directory);
	const path = join(directory, "tasks.json");
	const store = new FileTaskStore(path);
	return { directory, path, store, service: new TaskService(store) };
}

describe("FileTaskStore hardening", () => {
	it("creates a batch in one transaction and persists its ID ledger", async () => {
		const { path, service } = await harness();
		const first = await service.createMany([{ content: "A" }, { content: "B" }], actor, { operationId: "op_batch" });
		const replay = await service.createMany([{ content: "A" }, { content: "B" }], actor, { operationId: "op_batch" });
		expect(first.map((task) => task.id)).toEqual(["t1", "t2"]);
		expect(replay).toEqual(first);
		const persisted = JSON.parse(await readFile(path, "utf8"));
		expect(persisted.tasks).toHaveLength(2);
		expect(persisted.idempotency).toHaveLength(1);
	});

	it("rejects operation ID reuse with different parameters", async () => {
		const { service } = await harness();
		await service.create({ content: "A" }, actor, { operationId: "op_same" });
		await expect(service.create({ content: "B" }, actor, { operationId: "op_same" })).rejects.toBeInstanceOf(
			IdempotencyConflictError,
		);
	});

	it("rejects self-links and dependency cycles before committing", async () => {
		const { service, store } = await harness();
		const [a, b, c] = await service.createMany([{ content: "A" }, { content: "B" }, { content: "C" }], actor);
		await expect(service.applyUpdate(a.id, { addBlocks: [a.id] }, actor)).rejects.toThrow("cannot block itself");
		await service.applyUpdate(a.id, { addBlocks: [b.id] }, actor);
		await service.applyUpdate(b.id, { addBlocks: [c.id] }, actor);
		await expect(service.applyUpdate(c.id, { addBlocks: [a.id] }, actor)).rejects.toThrow("Dependency cycle");
		expect(store.get(c.id)?.blocks).toEqual([]);
	});

	it("serializes concurrent mutations without losing tasks", async () => {
		const { service, store } = await harness();
		await Promise.all(Array.from({ length: 20 }, (_, index) => service.create({ content: `Task ${index}` }, actor)));
		expect(store.list()).toHaveLength(20);
		expect(new Set(store.list().map((task) => task.id)).size).toBe(20);
	});

	it("preserves a corrupt file and surfaces its location", async () => {
		const { directory, path } = await harness();
		await writeFile(path, "not-json");
		let error: unknown;
		try {
			new FileTaskStore(path);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(TaskStoreCorruptionError);
		expect(await readdir(directory)).toContainEqual(expect.stringMatching(/^tasks\.json\.corrupt-/));
	});
});
