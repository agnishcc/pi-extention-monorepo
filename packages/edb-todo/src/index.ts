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

// Internal pi.events: edb-bridge emits this when a task_updated message arrives (from sub-agent)
const EV_BRIDGE_TASK_UPDATED = "bridge:task_updated";
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
	let currentSessionId: string | null = null;

	// Expose store path to other extensions (edb-subagents reads this to inject PI_TODO into sub-agents)
	function emitStorePath() {
		const p = store.path;
		if (p) pi.events.emit(EV_TODO_STORE_PATH, { path: p });
	}

	// Listen for bridge:task_updated (emitted by edb-bridge when a sub-agent updates a task)
	// Re-reads the store and refreshes the widget
	pi.events.on(EV_BRIDGE_TASK_UPDATED, () => {
		// Force a re-read from disk (sub-agent may have written to the shared file)
		if (store.path) {
			try {
				store.reload();
			} catch {
				/* ignore */
			}
		}
		widget.update();
	});

	// Listen for bridge:notify_parent — sub-agent progress update with optional task_id
	// When task_id is provided, update the task's activeForm so it shows in the spinner
	pi.events.on("bridge:notify_parent", (payload: unknown) => {
		const p = payload as { taskId?: string; message?: string; agentId?: string } | undefined;
		if (!p?.taskId || !p.message) return;
		void (async () => {
			// Update activeForm on the task so the widget spinner shows the progress message
			await taskService.applyUpdate(p.taskId!, { activeForm: p.message!.slice(0, 80) }, rootActor);
			widget.update();
		})().catch(() => {
			/* ignore */
		});
	});

	// Listen for bridge:ask_supervisor — sub-agent called ask_supervisor with a task_id
	// Auto-block the linked task so the widget shows ⏸ with the question text
	pi.events.on("bridge:ask_supervisor", (payload: unknown) => {
		const p = payload as { taskId?: string; question?: string; messageId?: string } | undefined;
		if (!p?.taskId || !p.question) return;
		void taskService
			.applyUpdate(
				p.taskId,
				{
					status: "blocked",
					blockQuestion: p.question,
					blockMessageId: p.messageId,
				},
				rootActor,
			)
			.then(() => widget.update())
			.catch(() => {});
	});

	// Listen for bridge:supervisor_answered — orchestrator answered, unblock the task
	pi.events.on("bridge:supervisor_answered", (payload: unknown) => {
		const p = payload as { taskId?: string } | undefined;
		if (!p?.taskId) return;
		void (async () => {
			// Transition back to in_progress and clear block metadata
			await taskService.applyUpdate(p.taskId!, { status: "in_progress" }, rootActor);
			widget.update();
		})().catch(() => {
			/* ignore */
		});
	});

	// Listen for todo:update_task — edb-subagents requests a task status update
	// This avoids edb-subagents duplicating FileTaskStore write logic
	pi.events.on("todo:update_task", (payload: unknown) => {
		const p = payload as { taskId?: string; fields?: { status?: string; owner?: string } } | undefined;
		if (!p?.taskId || !p.fields) return;
		void (async () => {
			await taskService.applyUpdate(p.taskId!, p.fields as any, rootActor);
			widget.update();
			// Notify bridge to propagate refresh to parent if we're in a sub-agent store
			notifyBridgeOnChange();
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

	// Helper to emit task_updated through bridge (so parent session widget refreshes)
	function notifyBridgeOnChange() {
		// Only route to parent when this is a sub-agent session (store was overridden from system prompt)
		if (!storeUpgraded) return;
		pi.events.emit(EV_BRIDGE_TASK_UPDATED, { storePath: store.path, sessionId: currentSessionId });
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
		currentSessionId = ctx.sessionManager.getSessionId();
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
		currentSessionId = ctx.sessionManager.getSessionId();
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
		description: `Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Batch vs single

Use the \`tasks\` array to create multiple tasks in a single call — **always prefer this over calling TaskCreate multiple times**:
\`\`\`json
{ "tasks": [ { "content": "Task A" }, { "content": "Task B", "description": "..." } ] }
\`\`\`
For a single task, pass the fields at the top level (\`content\`, \`description\`, etc.).

## Task Fields

- **content**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: Detailed description of what needs to be done, including context and acceptance criteria
- **activeForm** (optional): Present continuous form shown in the spinner when in_progress (e.g., "Fixing authentication bug"). If omitted, the spinner shows the content instead.
- **priority**: high / medium / low

All tasks are created with status \`pending\`.

## Tips

- Create tasks with clear, specific content that describes the outcome
- Include enough detail in the description for another agent to understand and complete the task
- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed
- Check TaskList first to avoid creating duplicate tasks
- **Always use tasks[] for multiple tasks** — one call instead of many`,
		promptGuidelines: [
			"When working on complex multi-step tasks, use TaskCreate to track progress and TaskUpdate to update status.",
			"To create multiple tasks, pass them all in a single call using the tasks[] array — never call TaskCreate multiple times.",
			"Mark tasks as in_progress before starting work and completed when done.",
			"Use TaskList to check for available work after completing a task.",
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
				notifyBridgeOnChange();
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
			notifyBridgeOnChange();
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
		description: `Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: pending, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **content**: Brief description of the task
- **status**: pending, in_progress, blocked, failed, cancelled, or completed
- **priority**: high, medium, or low
- **blockedBy**: Open task IDs that must be resolved first

Use TaskGet with a specific task ID to view full details including description.`,
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
		description: `Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **content**: Task title
- **description**: Detailed requirements and context
- **status**: pending, in_progress, blocked, failed, cancelled, or completed
- **priority**: high, medium, or low
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.`,
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
		description: `Use this tool to update a task in the task list.

## When to Use This Tool

**Before starting work on a task:**
- Mark it in_progress BEFORE beginning — do not start work without updating status first

**Mark tasks as completed:**
- When you have completed the work described in a task
- IMPORTANT: Always mark your tasks as completed when you finish them
- After completing, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to \`deleted\` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: pending → in_progress → completed, or blocked / failed / cancelled (deleted removes)
- **content**: Change the task title
- **description**: Change the task description
- **activeForm**: Spinner text when in_progress (e.g., "Running tests")
- **priority**: high, medium, or low
- **owner**: Agent name or owner
- **metadata**: Merge metadata keys (set a key to null to delete it)
- **addBlocks**: Task IDs that cannot start until this one completes
- **addBlockedBy**: Task IDs that must complete before this one can start

## Status Workflow

\`pending\` → \`in_progress\` → \`completed\`; use \`blocked\`, \`failed\`, or \`cancelled\` when work does not complete normally.

Use \`deleted\` to permanently remove a task.

## Examples

Mark as in progress:
\`{ "id": "t1", "status": "in_progress" }\`

Mark as completed:
\`{ "id": "t1", "status": "completed" }\`

Delete a task:
\`{ "id": "t1", "status": "deleted" }\`

Set dependencies:
\`{ "id": "t2", "addBlockedBy": ["t1"] }\``,
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

			notifyBridgeOnChange();
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
			"- Takes a task_id parameter identifying the task\n" +
			"- Returns the task output along with status information\n" +
			"- Use block=true (default) to wait for task completion\n" +
			"- Use block=false for a non-blocking check of current status\n" +
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
			"Stops a running background task process.\n" +
			"- Sends SIGTERM, waits 5 seconds, then SIGKILL if still running\n" +
			"- Marks the task as cancelled after stopping\n" +
			"- Use this tool when you need to terminate a long-running task",
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
