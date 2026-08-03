import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CoordinatorSnapshotV1 } from "../types.js";
import { emptySnapshot, validateSnapshot } from "./schema.js";

export class CoordinatorRecoveryError extends Error {
	constructor(public readonly paths: string[]) {
		super(`No valid coordinator snapshot found: ${paths.join(", ")}`);
		this.name = "CoordinatorRecoveryError";
	}
}

export class AtomicStore {
	readonly statePath: string;
	readonly backupPath: string;
	private queue: Promise<void> = Promise.resolve();
	private committedRevision = 0;

	constructor(
		readonly directory: string,
		private readonly rootSessionId: string,
		private readonly cwd: string,
	) {
		this.statePath = join(directory, "state.json");
		this.backupPath = join(directory, "state.json.bak");
	}

	async load(): Promise<{ snapshot: CoordinatorSnapshotV1; recoveredFromBackup: boolean; corruptPaths: string[] }> {
		await mkdir(this.directory, { recursive: true });
		await this.cleanTemporaryFiles();
		if (!existsSync(this.statePath) && !existsSync(this.backupPath)) {
			return { snapshot: emptySnapshot(this.rootSessionId, this.cwd), recoveredFromBackup: false, corruptPaths: [] };
		}
		const corruptPaths: string[] = [];
		const current = await this.readValidated(this.statePath, corruptPaths);
		if (current) {
			this.committedRevision = current.revision;
			return { snapshot: current, recoveredFromBackup: false, corruptPaths };
		}
		const backup = await this.readValidated(this.backupPath, corruptPaths);
		if (!backup) throw new CoordinatorRecoveryError(corruptPaths);
		this.committedRevision = backup.revision;
		return { snapshot: backup, recoveredFromBackup: true, corruptPaths };
	}

	private async readValidated(path: string, corruptPaths: string[]): Promise<CoordinatorSnapshotV1 | undefined> {
		if (!existsSync(path)) return undefined;
		try {
			const parsed = JSON.parse(await readFile(path, "utf8"));
			if (!validateSnapshot(parsed)) throw new Error("Invalid coordinator snapshot schema");
			if (parsed.rootSessionId !== this.rootSessionId)
				throw new Error("Snapshot belongs to a different root session");
			return parsed;
		} catch {
			const corruptPath = `${path}.corrupt-${Date.now()}`;
			await rename(path, corruptPath);
			corruptPaths.push(corruptPath);
			return undefined;
		}
	}

	async commit(snapshot: CoordinatorSnapshotV1): Promise<CoordinatorSnapshotV1> {
		let resolve!: (snapshot: CoordinatorSnapshotV1) => void;
		let reject!: (error: unknown) => void;
		const result = new Promise<CoordinatorSnapshotV1>((onResolve, onReject) => {
			resolve = onResolve;
			reject = onReject;
		});
		const job = this.queue.then(async () => {
			try {
				const next = structuredClone(snapshot);
				next.revision = this.committedRevision + 1;
				next.updatedAt = new Date().toISOString();
				if (!validateSnapshot(next)) throw new Error("Refusing to persist an invalid coordinator snapshot");
				await mkdir(dirname(this.statePath), { recursive: true });
				const temporaryPath = `${this.statePath}.tmp-${process.pid}-${next.revision}`;
				const handle = await open(temporaryPath, "w");
				try {
					await handle.writeFile(JSON.stringify(next, null, 2));
					await handle.sync();
				} finally {
					await handle.close();
				}
				if (existsSync(this.statePath)) {
					try {
						await unlink(this.backupPath);
					} catch (error: any) {
						if (error?.code !== "ENOENT") throw error;
					}
					await rename(this.statePath, this.backupPath);
				}
				await rename(temporaryPath, this.statePath);
				try {
					const directory = await open(this.directory, "r");
					try {
						await directory.sync();
					} finally {
						await directory.close();
					}
				} catch {
					// Directory fsync is unsupported on some platforms.
				}
				this.committedRevision = next.revision;
				resolve(next);
			} catch (error) {
				reject(error);
			}
		});
		this.queue = job.catch(() => {});
		return result;
	}

	async flush(): Promise<void> {
		await this.queue;
	}

	private async cleanTemporaryFiles(): Promise<void> {
		for (const name of await readdir(this.directory)) {
			if (!name.startsWith("state.json.tmp-")) continue;
			try {
				await unlink(join(this.directory, name));
			} catch {
				// Best effort after validation of state/backup.
			}
		}
	}
}
