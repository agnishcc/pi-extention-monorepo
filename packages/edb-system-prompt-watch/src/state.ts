import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir, VERSION } from "@earendil-works/pi-coding-agent";

export interface PromptWatchState {
	lastSeenPromptSourceHash?: string;
	lastSeenPiVersion?: string;
	lastSeenPromptSourcePath?: string;
	lastCheckedAt?: string;
}

export interface PromptSourceSnapshot {
	piVersion: string;
	promptSourcePath: string;
	promptSourceHash: string;
}

export interface PromptWatchResult {
	changed: boolean;
	firstRun: boolean;
	previous?: PromptWatchState;
	snapshot: PromptSourceSnapshot;
}

export function hashText(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

export function getStatePath(): string {
	return join(getAgentDir(), "state", "system-prompt-watch.json");
}

export function readState(statePath = getStatePath()): PromptWatchState | undefined {
	if (!existsSync(statePath)) return undefined;

	try {
		return JSON.parse(readFileSync(statePath, "utf8")) as PromptWatchState;
	} catch {
		return undefined;
	}
}

export function writeState(state: PromptWatchState, statePath = getStatePath()): void {
	mkdirSync(dirname(statePath), { recursive: true });
	writeFileSync(statePath, `${JSON.stringify(state, null, "\t")}\n`);
}

export async function getPromptSourceSnapshot(): Promise<PromptSourceSnapshot> {
	const packageEntryUrl = await import.meta.resolve("@earendil-works/pi-coding-agent");
	const packageEntry = fileURLToPath(packageEntryUrl);
	const packageRoot = dirname(dirname(packageEntry));
	const promptSourcePath = join(packageRoot, "dist", "core", "system-prompt.js");
	const promptSource = readFileSync(promptSourcePath, "utf8");

	return {
		piVersion: VERSION,
		promptSourcePath,
		promptSourceHash: hashText(promptSource),
	};
}

export async function checkPromptSource(previous = readState()): Promise<PromptWatchResult> {
	const snapshot = await getPromptSourceSnapshot();
	const firstRun = !previous?.lastSeenPromptSourceHash;
	const changed = !firstRun && previous.lastSeenPromptSourceHash !== snapshot.promptSourceHash;

	writeState({
		lastSeenPromptSourceHash: snapshot.promptSourceHash,
		lastSeenPiVersion: snapshot.piVersion,
		lastSeenPromptSourcePath: snapshot.promptSourcePath,
		lastCheckedAt: new Date().toISOString(),
	});

	return {
		changed,
		firstRun,
		previous,
		snapshot,
	};
}
