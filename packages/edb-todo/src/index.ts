/**
 * edb-todo
 *
 * Task management extension with pi-tasks tool names, descriptions, and behavior.
 *
 * Tools:
 *   TaskCreate  — Create a structured task
 *   TaskList    — List all tasks with status and blocked-by info
 *   TaskGet     — Get full task details, description, dependencies
 *   TaskUpdate  — Update status, fields, dependencies; status:"deleted" removes
 *
 * Command: /todos — interactive task manager with settings panel
 */

import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { AutoClearManager } from "./auto-clear.js";
import { openTodosMenu, TodoViewComponent } from "./component.js";
import { loadTodoConfig } from "./config.js";
import { FileTaskStore } from "./file-store.js";
import { ProcessTracker } from "./process-tracker.js";
import { buildSystemPromptBlock, formatListForLLM } from "./prompt.js";
import { createTodoCapability } from "./rpc/capability.js";
import { TodoRpcServer } from "./rpc/server.js";
import { TodoCreateParams, TodoGetParams, TodoUpdateParams } from "./schemas.js";
import { priorityColor, priorityLabel, renderTaskListResult, TodoWidget } from "./state.js";
import { TaskService } from "./task-service.js";
import type { TaskDetails, TaskPriority } from "./types.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const TASK_TOOL_NAMES = new Set(["TaskCreate", "TaskList", "TaskGet", "TaskUpdate", "TaskOutput", "TaskStop"]);
const REMINDER_INTERVAL = 4;
const AUTO_CLEAR_DELAY = 4;

const SYSTEM_REMINDER = `<system-reminder>
The task tools haven't been used recently. If you're working on tasks that would benefit from tracking progress, consider using TaskCreate to add new tasks and TaskUpdate to update task status (set to in_progress when starting, completed when done). Also consider cleaning up the task list if it has become stale. Only use these if relevant to the current work. This is just a gentle reminder - ignore if not applicable. Make sure that you NEVER mention this reminder to the user
</system-reminder>`;

// We emit this so edb-subagents can read the store path
const EV_TODO_STORE_PATH = "todo:store_path";

// ── Extension ──────────────────────────────────────────────────────────────────

export default function todoExtension(pi: ExtensionAPI): void {
	let cwd = process.cwd();
	let cfg = loadTodoConfig(cwd);
	const taskScope = cfg.taskScope ?? "session";

	function resolveStorePath(sessionId?: string): string | undefined {
		const envVal = process.env.PI_TODO;
		if (envVal === "off") return undefined;
		if (envVal?.startsWith("/")) return envVal;
		if (envVal?.startsWith(".")) return resolve(envVal);
		if (envVal) return join(process.env.HOME ?? "~", ".pi", "tasks", `${envVal}.json`);

		if (taskScope === "memory") return undefined;
		if (taskScope === "session" && sessionId) {
			return join(cwd, ".pi", "tasks", `tasks-${sessionId}.json`);
		}
		if (taskScope === "session") return undefined;
		return join(cwd, ".pi", "tasks", "tasks.json");
	}

	let store = new FileTaskStore(resolveStorePath());
	let taskService = new TaskService(store);
	let rpcServer: TodoRpcServer | undefined;
	const rootActor = { agentId: "root", runId: null };
	function setStore(nextStore: FileTaskStore) {
		store = nextStore;
		taskService = new TaskService(store);
		widget.setStore(store);
		autoClear.getService = () => taskService;
	}
	const tracker = new ProcessTracker();
	const widget = new TodoWidget(store);
	const autoClear = new AutoClearManager(
		() => taskService,
		() => cfg.autoClearCompleted ?? "on_list_complete",
		AUTO_CLEAR_DELAY,
	);
	/** The pi session ID of the current (or most recently started) session. */

	// Expose store path to other extensions (edb-subagents reads this to inject PI_TODO into sub-agents)
	function emitStorePath() {
		const p = store.path;
		if (p) pi.events.emit(EV_TODO_STORE_PATH, { path: p });
	}

	// Listen for todo:update_task — edb-subagents requests a task status update
	// This avoids edb-subagents duplicating FileTaskStore write logic
	pi.events.on("todo:update_task", (payload: unknown) => {
		const p = payload as { taskId?: string; fields?: { status?: string; owner?: string } } | undefined;
		if (!p?.taskId || !p.fields) return;
		void (async () => {
			await taskService.applyUpdate(p.taskId!, p.fields as any, rootActor);
			widget.update();
		})().catch(() => {
			/* ignore */
		});
	});

	// Parse task store path from system prompt (for sub-agent sessions)
	let storePathFromPromptParsed = false;

	function maybeOverrideStoreFromPrompt(systemPrompt: string, _sessionId: string) {
		if (storePathFromPromptParsed) return;
		storePathFromPromptParsed = true;
		const match = systemPrompt.match(/<task_store_path>(.*?)<\/task_store_path>/s);
		if (!match) return;
		const path = match[1]!.trim();
		if (path && path !== store.path) {
			setStore(new FileTaskStore(path));
			storeUpgraded = true; // prevent upgradeStoreIfNeeded from overriding
			emitStorePath();
		}
	}

	let storeUpgraded = false;
	let persistedTasksShown = false;

	function upgradeStoreIfNeeded(sessionId?: string) {
		if (storeUpgraded) return;
		if (taskScope === "session" && !process.env.PI_TODO) {
			const path = resolveStorePath(sessionId);
			if (path) {
				setStore(new FileTaskStore(path));
			}
		}
		storeUpgraded = true;
		emitStorePath();
	}

	async function showPersistedTasks(isResume = false) {
		if (persistedTasksShown) return;
		persistedTasksShown = true;
		const tasks = store.list();
		if (tasks.length > 0) {
			if (!isResume && tasks.every((t) => t.status === "completed")) {
				await taskService.clearCompleted(rootActor);
				if (taskScope === "session") store.deleteFileIfEmpty();
			} else {
				widget.update();
			}
		}
	}

	// ── Turn tracking ──────────────────────────────────────────────────────────
	let currentTurn = 0;
	let lastTaskToolUseTurn = 0;
	let reminderInjectedThisCycle = false;

	pi.on("turn_start", async (_event, ctx) => {
		currentTurn++;
		cwd = ctx.cwd;
		cfg = loadTodoConfig(cwd);
		widget.setUICtx(ctx.ui);
		upgradeStoreIfNeeded(ctx.sessionManager.getSessionId());
		if (await autoClear.onTurnStart(currentTurn)) widget.update();
	});

	// ── System-reminder injection ──────────────────────────────────────────────
	pi.on("tool_result", async (event) => {
		if (TASK_TOOL_NAMES.has(event.toolName)) {
			lastTaskToolUseTurn = currentTurn;
			reminderInjectedThisCycle = false;
			return {};
		}
		if (currentTurn - lastTaskToolUseTurn < REMINDER_INTERVAL) return {};
		if (reminderInjectedThisCycle) return {};
		if (store.list().length === 0) return {};
		reminderInjectedThisCycle = true;
		lastTaskToolUseTurn = currentTurn;
		return {
			content: [...event.content, { type: "text" as const, text: SYSTEM_REMINDER }],
		};
	});

	// ── System-prompt injection ────────────────────────────────────────────────
	pi.on("before_agent_start", async (event, ctx) => {
		cwd = ctx.cwd;
		cfg = loadTodoConfig(cwd);

		widget.setUICtx(ctx.ui);
		// For sub-agent sessions: read store path from system prompt (injected by edb-subagents)
		maybeOverrideStoreFromPrompt(event.systemPrompt, ctx.sessionManager.getSessionId());
		upgradeStoreIfNeeded(ctx.sessionManager.getSessionId());
		await showPersistedTasks();
		const block = buildSystemPromptBlock(store);
		if (!block) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${block}` };
	});

	pi.on("agent_end", async (_event, ctx) => {
		widget.setUICtx(ctx.ui);
		widget.update();
	});

	// ── Session lifecycle ──────────────────────────────────────────────────────
	pi.on("session_start", async (event, ctx) => {
		const isResume = event.reason === "resume";
		cwd = ctx.cwd;
		cfg = loadTodoConfig(cwd);

		storeUpgraded = false;
		persistedTasksShown = false;
		storePathFromPromptParsed = false;
		currentTurn = 0;
		lastTaskToolUseTurn = 0;
		reminderInjectedThisCycle = false;
		autoClear.reset();
		if (!isResume && taskScope === "memory") await taskService.clearAll(rootActor);
		upgradeStoreIfNeeded(ctx.sessionManager.getSessionId());
		widget.setUICtx(ctx.ui);
		await showPersistedTasks(isResume);
		rpcServer?.dispose();
		rpcServer = new TodoRpcServer(pi, taskService, createTodoCapability(ctx.sessionManager.getSessionId()), () =>
			widget.update(),
		);
		rpcServer.start();
	});

	pi.on("session_shutdown", async () => {
		rpcServer?.dispose();
		rpcServer = undefined;
		widget.dispose();
		await store.cleanup();
	});

	pi.on("session_tree", async (_event, ctx) => {
		widget.setUICtx(ctx.ui);
		widget.update();
	});

	// ── Tool: TaskCreate ───────────────────────────────────────────────────────
	pi.registerTool({
		name: "TaskCreate",
		label: "TaskCreate",
		description: `Create tasks to track progress on complex, multi-step work. Use proactively when: 3+ distinct steps, the user explicitly asks for a todo list, multiple tasks are given, or new instructions arrive. Skip for trivial or conversational work — one-off tasks don't need tracking.

Prefer the \`tasks\` array to create several at once — one call instead of many:
\`\`\`json
{ "tasks": [ { "content": "Task A" }, { "content": "Task B", "description": "..." } ] }
\`\`\`
For a single task, pass the fields at the top level.

Fields: content (imperative title), description (context / acceptance criteria), priority (high/medium/low), activeForm (spinner text while in_progress). Tasks start as pending.

Check TaskList first to avoid duplicates; wire dependencies later with TaskUpdate (blocks / blockedBy).`,
		promptGuidelines: [
			"Use TaskCreate to track complex multi-step work — mark in_progress before starting and completed when done.",
			"Create multiple tasks in one call via the tasks[] array — never call TaskCreate repeatedly.",
			"Check TaskList after completing a task for newly unblocked work.",
		],
		parameters: TodoCreateParams,

		async execute(_id, params, _signal, _onUpdate, ctx) {
			autoClear.resetBatchCountdown();
			widget.setUICtx(ctx.ui);

			// ── Batch mode: tasks[] provided ──────────────────────────────────
			const batchItems = params.tasks as
				| Array<{
						content: string;
						description?: string;
						priority?: string;
						activeForm?: string;
						parentId?: string;
						groupId?: string;
						metadata?: Record<string, unknown>;
				  }>
				| undefined;

			if (batchItems && batchItems.length > 0) {
				const created = await taskService.createMany(
					batchItems.map((item) => ({
						content: item.content,
						description: item.description,
						priority: item.priority as TaskPriority | undefined,
						activeForm: item.activeForm,
						parentId: item.parentId,
						groupId: item.groupId,
						metadata: item.metadata,
					})),
					rootActor,
				);
				widget.update();
				const summary = created.map((t) => `#${t.id}: ${t.content}`).join(", ");
				return {
					content: [
						{
							type: "text" as const,
							text: `Created ${created.length} task${created.length === 1 ? "" : "s"}: ${summary}`,
						},
					],
					details: { tasks: [...store.list()] } satisfies TaskDetails,
				};
			}

			// ── Single-task mode: top-level fields ──────────────────────────────
			if (!params.content) {
				return {
					content: [
						{
							type: "text" as const,
							text: "TaskCreate requires either a tasks[] array or a top-level content field.",
						},
					],
					details: { tasks: [...store.list()] } satisfies TaskDetails,
				};
			}
			const task = await taskService.create(
				{
					content: params.content,
					description: params.description,
					priority: params.priority as TaskPriority | undefined,
					activeForm: params.activeForm,
					parentId: params.parentId as string | undefined,
					groupId: params.groupId as string | undefined,
					metadata: params.metadata,
				},
				rootActor,
			);
			widget.update();
			return {
				content: [{ type: "text", text: `Task #${task.id} created successfully: ${task.content}` }],
				details: { tasks: [...store.list()] } satisfies TaskDetails,
			};
		},

		renderCall(args, theme) {
			const batchTasks = args.tasks as Array<{ content?: string }> | undefined;
			if (batchTasks && batchTasks.length > 0) {
				const preview = batchTasks
					.slice(0, 3)
					.map((t) => t.content ?? "")
					.filter(Boolean)
					.join(", ");
				const extra = batchTasks.length > 3 ? ` +${batchTasks.length - 3} more` : "";
				return new Text(
					`${theme.fg("toolTitle", theme.bold("TaskCreate "))}${theme.fg("dim", `[${batchTasks.length}]`)}  ${theme.fg("muted", preview + extra)}`,
					0,
					0,
				);
			}
			const content = (args.content as string) ?? "";
			const priority = (args.priority as string) ?? "medium";
			const pColor = priorityColor(priority as TaskPriority);
			const pLabel = theme.fg(pColor, priorityLabel(priority as TaskPriority));
			return new Text(
				`${theme.fg("toolTitle", theme.bold("TaskCreate ")) + pLabel}  ${theme.fg("muted", content)}`,
				0,
				0,
			);
		},

		renderResult(result, { expanded }, theme) {
			return TodoViewComponent.renderTaskResult(result.details as TaskDetails | undefined, expanded, theme);
		},
	});

	// ── Tool: TaskList ─────────────────────────────────────────────────────────
	pi.registerTool({
		name: "TaskList",
		label: "TaskList",
		description: `List all tasks with status, priority, and dependency info.

Use to: see available (pending, unblocked) work, check overall progress, find blocked tasks needing resolution, and check for newly unblocked work after completing a task. Prefer working on tasks in ID order (lowest first).

Output fields per task: id, content, status (pending/in_progress/blocked/failed/cancelled/completed), priority (high/medium/low), blockedBy (open IDs that must resolve first). Use TaskGet with a task ID for full details.`,
		promptSnippet: "List all tasks in the task list with status, priority, and dependency info",
		parameters: Type.Object({}),

		async execute() {
			const tasks = store.list();
			if (tasks.length === 0)
				return {
					content: [{ type: "text", text: "No tasks found" }],
					details: { tasks: [] } satisfies TaskDetails,
				};

			const statusOrder: Record<string, number> = {
				pending: 0,
				in_progress: 1,
				blocked: 2,
				failed: 3,
				cancelled: 4,
				completed: 5,
			};
			const sorted = [...tasks].sort((a, b) => {
				const so = (statusOrder[a.status] ?? 0) - (statusOrder[b.status] ?? 0);
				if (so !== 0) return so;
				return a.id.localeCompare(b.id);
			});

			const lines = sorted.map((task) => {
				let line = `[${task.status}] [${task.priority}] #${task.id} ${task.content}`;
				if (task.parentId) line += ` [subtask of #${task.parentId}]`;
				if (task.owner) line += ` [owner: ${task.owner}]`;
				if (task.status === "blocked" && task.blockQuestion) {
					line += ` [blocked: "${task.blockQuestion.slice(0, 60)}"]`;
				}
				const openBlockers = task.blockedBy.filter((bid) => {
					const b = store.get(bid);
					return b && b.status !== "completed";
				});
				if (openBlockers.length > 0) line += ` [blocked by ${openBlockers.map((id) => `#${id}`).join(", ")}]`;
				if (task.blockedByGroup && !store.isGroupComplete(task.blockedByGroup)) {
					line += ` [waiting for group: ${task.blockedByGroup}]`;
				}
				return line;
			});

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { tasks: sorted } satisfies TaskDetails,
			};
		},

		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("TaskList")), 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			return TodoViewComponent.renderTaskResult(result.details as TaskDetails | undefined, expanded, theme);
		},
	});

	// ── Tool: TaskGet ──────────────────────────────────────────────────────────
	pi.registerTool({
		name: "TaskGet",
		label: "TaskGet",
		description: `Retrieve a task by ID with full details.

Use when: you need full description/context before starting work, to understand dependencies (what it blocks / what blocks it), or after being assigned a task.

Returns: content, description, status (pending/in_progress/blocked/failed/cancelled/completed), priority (high/medium/low), blocks (tasks waiting on it), blockedBy (tasks that must finish first). After fetching, verify blockedBy is empty before starting. Use TaskList for summaries.`,
		promptSnippet: "Retrieve full details of a task by ID, including description and dependencies",
		parameters: TodoGetParams,

		async execute(_id, params) {
			const task = store.get(params.id);
			if (!task) {
				return {
					content: [{ type: "text", text: `Task not found` }],
					details: undefined,
				};
			}

			const desc = task.description?.replace(/\\n/g, "\n") ?? "(no description)";
			const lines: string[] = [
				`Task #${task.id}: ${task.content}`,
				`Status: ${task.status}`,
				`Priority: ${task.priority}`,
			];
			if (task.owner) lines.push(`Owner: ${task.owner}`);
			if (task.parentId) lines.push(`Subtask of: #${task.parentId}`);
			if (task.groupId) lines.push(`Parallel group: ${task.groupId}`);
			if (task.blockedByGroup) {
				const groupDone = store.isGroupComplete(task.blockedByGroup);
				lines.push(`Blocked by group: ${task.blockedByGroup} (${groupDone ? "resolved" : "waiting"})`);
			}
			if (task.status === "blocked" && task.blockQuestion) {
				lines.push(`Blocked waiting for answer: "${task.blockQuestion}"`);
			}
			lines.push(`Description: ${desc}`);

			const openBlockers = task.blockedBy.filter((bid) => {
				const b = store.get(bid);
				return b && b.status !== "completed";
			});
			if (openBlockers.length > 0) lines.push(`Blocked by: ${openBlockers.map((id) => `#${id}`).join(", ")}`);
			if (task.blocks.length > 0) lines.push(`Blocks: ${task.blocks.map((id) => `#${id}`).join(", ")}`);
			const metaKeys = Object.keys(task.metadata);
			if (metaKeys.length > 0) lines.push(`Metadata: ${JSON.stringify(task.metadata)}`);

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: { tasks: [task] } satisfies TaskDetails,
			};
		},

		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("TaskGet ")) + theme.fg("muted", `#${args.id}`), 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			return renderTaskListResult((result.details as TaskDetails | undefined)?.tasks ?? [], expanded, theme);
		},
	});

	// ── Tool: TaskUpdate ───────────────────────────────────────────────────────
	pi.registerTool({
		name: "TaskUpdate",
		label: "TaskUpdate",
		description: `Update a task in the task list.

Mark in_progress BEFORE starting work; mark completed ONLY when fully done (not when tests are failing, implementation is partial, or errors are unresolved). When blocked, keep in_progress and create a task describing what needs resolving. After completing, call TaskList for the next task.

Fields: status (pending → in_progress → completed; or blocked/failed/cancelled; deleted removes), content, description, activeForm (spinner text), priority, owner, metadata (merge; null deletes a key), addBlocks (IDs that can't start until this completes), addBlockedBy (IDs that must complete first).

Examples: { "id": "t1", "status": "in_progress" } · { "id": "t1", "status": "completed" } · { "id": "t1", "status": "deleted" } · { "id": "t2", "addBlockedBy": ["t1"] }`,
		promptSnippet: "Update a task's status, content, priority, or dependency links",
		promptGuidelines: [
			"Mark tasks in_progress BEFORE starting work, completed immediately after finishing. Never batch completions.",
			"ONLY mark completed when fully done — not when tests are failing or implementation is partial.",
		],
		parameters: TodoUpdateParams,

		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { id, ...fields } = params;
			const { task, changedFields, warnings } = await taskService.applyUpdate(id, fields as any, rootActor);

			if (changedFields.length === 0 && !task) {
				return {
					content: [{ type: "text", text: `Task #${id} not found` }],
					details: { tasks: [...store.list()] } satisfies TaskDetails,
				};
			}

			// Early return from enforcement (e.g. blockedByGroup)
			if (changedFields.length === 0 && warnings.length > 0) {
				return {
					content: [{ type: "text", text: `⚠ Not updated: ${warnings.join("; ")}` }],
					details: { tasks: [...store.list()] } satisfies TaskDetails,
				};
			}

			if (fields.status === "in_progress") {
				widget.setActiveTask(id);
				autoClear.resetBatchCountdown();
			} else if (fields.status === "pending") {
				autoClear.resetBatchCountdown();
			} else if (fields.status === "completed") {
				widget.setActiveTask(id, false);
				autoClear.trackCompletion(id, currentTurn);
			} else if (fields.status === "deleted") {
				widget.setActiveTask(id, false);
			} else if (fields.status === "blocked") {
				widget.setActiveTask(id, false); // stop spinner while blocked
			}

			widget.setUICtx(ctx.ui);
			widget.update();

			let msg: string;
			if (changedFields.includes("deleted")) {
				msg = `→ Updated task #${id} deleted`;
			} else {
				msg = `→ Updated task #${id} ${changedFields.join(", ")}`;
			}
			if (warnings.length > 0) msg += ` (warning: ${warnings.join("; ")})`;

			return {
				content: [{ type: "text", text: msg }],
				details: { tasks: [...store.list()] } satisfies TaskDetails,
			};
		},

		renderCall(args, theme) {
			const id = args.id as string;
			const status = args.status as string | undefined;
			let extra = "";
			if (status) extra = `  ${theme.fg("muted", `→ ${status}`)}`;
			return new Text(theme.fg("toolTitle", theme.bold("TaskUpdate ")) + theme.fg("accent", `#${id}`) + extra, 0, 0);
		},

		renderResult(result, { expanded }, theme) {
			return TodoViewComponent.renderTaskResult(result.details as TaskDetails | undefined, expanded, theme);
		},
	});

	// ── Tool: TaskOutput ────────────────────────────────────────────
	pi.registerTool({
		name: "TaskOutput",
		label: "TaskOutput",
		description:
			"Retrieves output from a running or completed background task process.\n" +
			"- task_id: the task to inspect\n" +
			"- block=true (default) waits for completion; block=false returns current status immediately\n" +
			"- Task IDs can be found using TaskList",
		promptSnippet: "Retrieve output from a running or completed background task process",
		parameters: Type.Object({
			task_id: Type.String({ description: "The task ID to get output from" }),
			block: Type.Optional(Type.Boolean({ description: "Whether to wait for completion (default: true)" })),
			timeout: Type.Optional(
				Type.Number({
					description: "Max wait time in ms (default: 30000, max: 600000)",
					minimum: 0,
					maximum: 600000,
				}),
			),
		}),

		async execute(_id, params, signal) {
			const { task_id, block = true, timeout = 30000 } = params;
			const processOutput = tracker.getOutput(task_id);

			if (!processOutput) {
				const task = store.get(task_id);
				if (!task) {
					return {
						content: [{ type: "text", text: `No task or process found with ID ${task_id}` }],
						details: undefined,
					};
				}
				return {
					content: [{ type: "text", text: `Task #${task_id} [${task.status}] — no background process attached` }],
					details: undefined,
				};
			}

			if (block && processOutput.status === "running") {
				const result = await tracker.waitForCompletion(task_id, timeout, signal ?? undefined);
				if (result) {
					return {
						content: [
							{
								type: "text",
								text: `Task #${task_id} (${result.status})${result.exitCode !== undefined ? ` exit ${result.exitCode}` : ""}\n\n${result.output}`,
							},
						],
						details: undefined,
					};
				}
			}

			return {
				content: [
					{
						type: "text",
						text: `Task #${task_id} (${processOutput.status})${processOutput.exitCode !== undefined ? ` exit ${processOutput.exitCode}` : ""}\n\n${processOutput.output}`,
					},
				],
				details: undefined,
			};
		},

		renderCall(args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("TaskOutput ")) + theme.fg("muted", `#${args.task_id}`),
				0,
				0,
			);
		},
	});

	// ── Tool: TaskStop ──────────────────────────────────────────────
	pi.registerTool({
		name: "TaskStop",
		label: "TaskStop",
		description:
			"Stops a running background task process (SIGTERM, then SIGKILL after 5s; marks the task cancelled).",
		promptSnippet: "Stop a running background task process",
		parameters: Type.Object({
			task_id: Type.String({ description: "The task ID of the background process to stop" }),
		}),

		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { task_id } = params;
			const stopped = await tracker.stop(task_id);

			if (!stopped) {
				const task = store.get(task_id);
				if (!task)
					return {
						content: [{ type: "text", text: `No running background process for task ${task_id}` }],
						details: undefined,
					};
				return {
					content: [
						{ type: "text", text: `Task #${task_id} has no running background process (status: ${task.status})` },
					],
					details: undefined,
				};
			}

			await taskService.applyUpdate(task_id, { status: "cancelled" }, rootActor);
			autoClear.trackCompletion(task_id, currentTurn);
			widget.setActiveTask(task_id, false);
			widget.setUICtx(ctx.ui);
			widget.update();

			return { content: [{ type: "text", text: `Task #${task_id} stopped successfully` }], details: undefined };
		},

		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("TaskStop ")) + theme.fg("accent", `#${args.task_id}`), 0, 0);
		},
	});

	// ── Command: /todos ────────────────────────────────────────────────────────
	pi.registerCommand("todos", {
		description: "Open the interactive task viewer and manager",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify(store.list().length === 0 ? "No tasks yet." : formatListForLLM(store), "info");
				return;
			}
			await openTodosMenu(ctx.ui, store, taskService, cfg, cwd, (taskId, status) => {
				if (status === "in_progress") widget.setActiveTask(taskId);
				else if (status) widget.setActiveTask(taskId, false);
				widget.update();
			});
		},
	});
}
