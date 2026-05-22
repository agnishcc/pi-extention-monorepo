import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BRIDGE_DIR, getBrokerPidPath, getBrokerSocketPath, getSpawnLockPath } from "./paths.js";

const SOCKET_PATH = getBrokerSocketPath();
const PID_PATH = getBrokerPidPath();
const LOCK_PATH = getSpawnLockPath();

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkConnectable(): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = net.connect(SOCKET_PATH);
		const finish = (ok: boolean) => {
			clearTimeout(t);
			socket.off("connect", onConnect);
			socket.off("error", onError);
			resolve(ok);
		};
		const onConnect = () => {
			socket.end();
			finish(true);
		};
		const onError = () => {
			socket.destroy();
			finish(false);
		};
		const t = setTimeout(() => {
			socket.destroy();
			finish(false);
		}, 1000);
		socket.on("connect", onConnect);
		socket.on("error", onError);
	});
}

async function isBrokerRunning(): Promise<boolean> {
	if (await checkConnectable()) return true;
	if (!existsSync(PID_PATH)) return false;
	try {
		const pid = parseInt(readFileSync(PID_PATH, "utf-8").trim(), 10);
		if (!Number.isFinite(pid)) return false;
		process.kill(pid, 0);
		return checkConnectable();
	} catch {
		return false;
	}
}

function acquireLock(): boolean {
	for (let i = 0; i < 5; i++) {
		try {
			writeFileSync(LOCK_PATH, `${process.pid}\n${Date.now()}\n`, { flag: "wx" });
			return true;
		} catch (err: any) {
			if (err.code !== "EEXIST") throw err;
			// Check if stale
			try {
				const [pidLine = "", tsLine = "0"] = readFileSync(LOCK_PATH, "utf-8").trim().split("\n");
				const pid = Number.parseInt(pidLine, 10);
				const age = Date.now() - Number.parseInt(tsLine, 10);
				let stale = age > 10_000;
				if (!stale && Number.isFinite(pid)) {
					try {
						process.kill(pid, 0);
					} catch {
						stale = true;
					}
				}
				if (stale) {
					try {
						unlinkSync(LOCK_PATH);
					} catch {
						/* ignore */
					}
					continue;
				}
			} catch {
				/* unreadable = stale */
			}
			return false;
		}
	}
	return false;
}

function releaseLock(): void {
	try {
		unlinkSync(LOCK_PATH);
	} catch {
		/* ignore */
	}
}

async function waitForBroker(timeoutMs = 5000): Promise<void> {
	const end = Date.now() + timeoutMs;
	while (Date.now() < end) {
		if (await checkConnectable()) return;
		await sleep(100);
	}
	throw new Error("edb-bridge: broker failed to start within timeout");
}

export async function spawnBrokerIfNeeded(): Promise<void> {
	mkdirSync(BRIDGE_DIR, { recursive: true });
	if (await isBrokerRunning()) return;

	const hasLock = acquireLock();
	if (!hasLock) {
		await waitForBroker();
		return;
	}

	try {
		if (await isBrokerRunning()) return;

		const brokerPath = join(dirname(fileURLToPath(import.meta.url)), "broker.ts");
		const nodePath = process.execPath;

		// Locate tsx cli next to this package
		const tsxCli = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "tsx", "dist", "cli.mjs");
		const [cmd, args] = existsSync(tsxCli)
			? [nodePath, [tsxCli, brokerPath]]
			: ["npx", ["--no-install", "tsx", brokerPath]];

		const child = spawn(cmd, args, {
			detached: true,
			stdio: "ignore",
			cwd: dirname(brokerPath),
			env: { ...process.env, NODE_NO_WARNINGS: "1" },
			windowsHide: true,
		});
		child.unref();

		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				child.off("error", onError);
				child.off("exit", onExit);
			};
			const onError = (err: Error) => {
				cleanup();
				reject(err);
			};
			const onExit = (code: number | null) => {
				cleanup();
				reject(new Error(`edb-bridge broker exited early with code ${code}`));
			};
			child.once("error", onError);
			child.once("exit", onExit);
			waitForBroker().then(
				() => {
					cleanup();
					resolve();
				},
				(e) => {
					cleanup();
					reject(e);
				},
			);
		});
	} finally {
		releaseLock();
	}
}
