import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface SubagentsV2Settings {
	engine: "v1" | "v2";
	maxConcurrentPrompts: number;
	maxChildrenPerParent: number;
	maxDepth: number;
	maxActiveDescendants: number;
	foregroundWaitTimeoutMs: number;
	idleRuntimeEvictionMs: number;
	maxResultBytes: number;
	maxTranscriptBytes: number;
	autoCompleteLinkedTasks: boolean;
	projectAgents: "trusted" | "disabled";
	retentionDays: number;
}

export const DEFAULT_V2_SETTINGS: SubagentsV2Settings = {
	engine: "v1",
	maxConcurrentPrompts: 4,
	maxChildrenPerParent: 2,
	maxDepth: 4,
	maxActiveDescendants: 16,
	foregroundWaitTimeoutMs: 1_800_000,
	idleRuntimeEvictionMs: 600_000,
	maxResultBytes: 51_200,
	maxTranscriptBytes: 102_400,
	autoCompleteLinkedTasks: true,
	projectAgents: "trusted",
	retentionDays: 30,
};

const numericKeys = [
	"maxConcurrentPrompts",
	"maxChildrenPerParent",
	"maxDepth",
	"maxActiveDescendants",
	"foregroundWaitTimeoutMs",
	"idleRuntimeEvictionMs",
	"maxResultBytes",
	"maxTranscriptBytes",
	"retentionDays",
] as const;

function read(path: string): Partial<SubagentsV2Settings> {
	if (!existsSync(path)) return {};
	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		const result: Partial<SubagentsV2Settings> = {};
		if (raw.engine === "v1" || raw.engine === "v2") result.engine = raw.engine;
		if (raw.projectAgents === "trusted" || raw.projectAgents === "disabled") result.projectAgents = raw.projectAgents;
		if (typeof raw.autoCompleteLinkedTasks === "boolean")
			result.autoCompleteLinkedTasks = raw.autoCompleteLinkedTasks;
		for (const key of numericKeys) {
			if (Number.isInteger(raw[key]) && (raw[key] as number) > 0) (result as any)[key] = raw[key];
		}
		return result;
	} catch (error) {
		console.warn(`[edb-subagents-v2] Ignoring malformed settings at ${path}: ${String(error)}`);
		return {};
	}
}

export function loadV2Settings(cwd = process.cwd()): SubagentsV2Settings {
	return {
		...DEFAULT_V2_SETTINGS,
		...read(join(getAgentDir(), "subagents.json")),
		...read(join(cwd, ".pi", "subagents.json")),
	};
}
