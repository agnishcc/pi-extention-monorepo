// <cwd>/.pi/tasks-config.json — persists extension settings across sessions

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface TodoConfig {
	/** Where tasks are stored. Default: "session" */
	taskScope?: "memory" | "session" | "project";
	/** Auto-clear completed tasks. Default: "on_list_complete" */
	autoClearCompleted?: "never" | "on_list_complete" | "on_task_complete";
}

export function loadTodoConfig(cwd: string): TodoConfig {
	try {
		return JSON.parse(readFileSync(join(cwd, ".pi", "tasks-config.json"), "utf-8"));
	} catch {
		return {};
	}
}

export function saveTodoConfig(cwd: string, config: TodoConfig): void {
	const path = join(cwd, ".pi", "tasks-config.json");
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(config, null, 2));
}
