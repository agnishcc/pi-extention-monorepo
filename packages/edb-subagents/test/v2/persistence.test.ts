import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AtomicStore } from "../../src/v2/persistence/atomic-store.js";
import { emptySnapshot } from "../../src/v2/persistence/schema.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("AtomicStore", () => {
	it("commits serialized revisions and keeps a valid backup", async () => {
		const directory = await mkdtemp(join(tmpdir(), "edb-coordinator-store-"));
		directories.push(directory);
		const store = new AtomicStore(directory, "root_test", "/tmp");
		const first = await store.commit(emptySnapshot("root_test", "/tmp"));
		const second = await store.commit({ ...first, mailbox: [] });
		expect(first.revision).toBe(1);
		expect(second.revision).toBe(2);
		expect(JSON.parse(await readFile(join(directory, "state.json.bak"), "utf8")).revision).toBe(1);
	});

	it("preserves a corrupt current snapshot and recovers its backup", async () => {
		const directory = await mkdtemp(join(tmpdir(), "edb-coordinator-store-"));
		directories.push(directory);
		const store = new AtomicStore(directory, "root_test", "/tmp");
		const first = await store.commit(emptySnapshot("root_test", "/tmp"));
		await store.commit(first);
		await writeFile(join(directory, "state.json"), "corrupt");
		const recovered = await new AtomicStore(directory, "root_test", "/tmp").load();
		expect(recovered.recoveredFromBackup).toBe(true);
		expect(recovered.snapshot.revision).toBe(1);
		expect(recovered.corruptPaths[0]).toContain(".corrupt-");
	});
});
