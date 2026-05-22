import { homedir } from "node:os";
import { join } from "node:path";

const BRIDGE_DIR = join(homedir(), ".pi", "agent", "edb-bridge");

export function getBrokerSocketPath(): string {
	if (process.platform === "win32") {
		const seg = homedir()
			.replace(/[^a-zA-Z0-9]/g, "-")
			.replace(/^-+|-+$/g, "")
			.toLowerCase();
		return `\\\\.\\pipe\\edb-bridge-${seg}`;
	}
	return join(BRIDGE_DIR, "broker.sock");
}

export function getBrokerPidPath(): string {
	return join(BRIDGE_DIR, "broker.pid");
}

export function getSpawnLockPath(): string {
	return join(BRIDGE_DIR, "broker.spawn.lock");
}

export { BRIDGE_DIR };
