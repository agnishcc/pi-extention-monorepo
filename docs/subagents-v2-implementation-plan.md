# Subagent System V2 — Complete Implementation Plan

**Status:** Ready for Phase 0 validation
**Repository:** `pi-extention-monorepo`
**Primary package:** `packages/edb-subagents`
**Optional integration:** `packages/edb-todo`
**Package removed from the core path:** `packages/edb-bridge`
**Target runtime:** Current supported Pi SDK (`0.83.x` when this plan was written), Node.js `>=22.19`

---

## 1. Purpose

Rebuild the subagent system around one deterministic coordinator so that:

1. The main agent can spawn child agents.
2. Every child can recursively spawn its own children.
3. A child can ask its direct parent a question.
4. A parent can answer, or escalate the question to its own parent.
5. The root agent can ask the human when no agent can answer.
6. A parent can either wait for a child or let it run in the background.
7. A running child can be steered.
8. An idle child can receive a follow-up using the same persisted conversation.
9. Tasks show which agent is responsible for them.
10. All agents can use the task extension without owning task persistence.
11. The system survives extension shutdown and process restart without silently corrupting task or agent state.

This is a new orchestration implementation, not an incremental repair of the existing manager/bridge lifecycle.

---

## 2. Architectural decisions

These decisions are fixed for V2 unless a Phase 0 SDK validation fails.

| Area | Decision |
|---|---|
| Orchestration | One `Coordinator` instance owns all agent and run transitions for one root Pi session. |
| Execution | In-process Pi `AgentSession` children. |
| Parent/child communication | Direct coordinator calls and persisted mailboxes. No Unix socket broker. |
| Agent context | Persistent Pi sessions; each agent has one stable session identity. |
| Tasks | `edb-todo` remains standalone and owns all task behavior and persistence. |
| Child task access | Lightweight task proxy tools call the coordinator, which calls a versioned todo RPC adapter. |
| Persistence | Pi JSONL for conversations; an atomic JSON snapshot/outbox for coordinator metadata. No SQLite in V2. |
| Waiting | Actor-style logical waiting. Never hold a recursive child wait inside a long-lived tool promise. |
| Concurrency | Permits are held only for active agent prompt segments, never while an agent is waiting on a parent or child. |
| Extensions in children | Disabled. Children receive an exact list of built-in and coordinator-provided custom tools. |
| Project agents | Loaded only after Pi reports the project trusted. |
| Scheduling | Excluded from V2. |
| Worktrees | Excluded from V2. |
| Model fallback retries | Excluded from V2. |
| Broker | Not required or started by V2. |

### Why logical waiting is mandatory

A parent `AgentSession` cannot keep a blocking `Agent` tool call open while its child runs if recursive spawning must also work under bounded concurrency. With a global concurrency of one, the parent would retain the only active prompt slot and the child could never start.

Therefore foreground waiting behaves as follows:

1. Parent calls `Agent({ run_in_background: false })`.
2. The tool creates the child and a durable parent-child wait link.
3. The tool returns a structured `waiting` result with `terminate: true`.
4. The parent prompt segment ends and releases its concurrency permit.
5. The child runs.
6. The coordinator later resumes the parent with a structured completion or question event.

From the model's perspective the parent waits and resumes automatically. Internally no JavaScript promise holds the parent prompt open.

---

## 3. Scope

### 3.1 Required in V2

- Recursive parent/child agent tree.
- Stable canonical agent IDs.
- Persistent reusable child sessions.
- Foreground and background execution.
- Logical wait and automatic parent resumption.
- Background completion notifications.
- Parent question routing.
- Nested escalation to the root and human.
- Steering, follow-up, cancellation and result retrieval.
- Global and per-parent concurrency limits.
- Recursion and descendant limits.
- Optional `edb-todo` integration.
- Correct task ownership and blocked/unblocked transitions.
- Atomic coordinator persistence.
- Durable external-operation outbox.
- Startup reconciliation and shutdown cleanup.
- Exact child capabilities and trusted-project enforcement.
- Bounded output and retention.
- Unit, integration, recovery and published-package smoke tests.

### 3.2 Explicit non-goals

Do not implement these while building V2:

- Cron or delayed scheduling.
- Worktree creation, commit or cleanup.
- Cross-process agents.
- Unix socket transport.
- Arbitrary parent-extension inheritance.
- Automatic model fallback.
- Long-term semantic memory.
- Process attachment/output tools.
- Agent group join heuristics.
- Multi-host execution.
- Multiple Pi processes sharing one coordinator.

Each non-goal may be added later behind a stable coordinator interface. None may be mixed into the V2 core during initial implementation.

---

## 4. Target component structure

```text
┌──────────────────────────────────────────────────────────────┐
│                    Root Pi AgentSession                      │
│                  canonical AgentId = root                    │
│                                                              │
│ Registered tools, commands, TUI and human interaction        │
└──────────────────────────────┬───────────────────────────────┘
                               │ typed coordinator calls
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                         Coordinator                          │
│                                                              │
│ AgentRegistry     RunQueue          QuestionService          │
│ Mailbox           WaitLinks         RuntimePool              │
│ TodoClient        DurableOutbox     AtomicStore               │
│                                                              │
│ Sole authority for Agent, Run, Question and linkage state    │
└───────────────┬───────────────────┬──────────────────────────┘
                │                   │
                │ exact custom      │ versioned root-bus RPC
                │ tools/callbacks   │
                ▼                   ▼
┌──────────────────────────┐   ┌──────────────────────────────┐
│ Child AgentSession tree  │   │          edb-todo            │
│                          │   │                              │
│ Persistent Pi JSONL      │   │ TaskService                 │
│ Exact built-in tools     │   │ FileTaskStore               │
│ Coordinator custom tools│   │ Task tools and widget       │
│ No extension discovery   │   │ Todo RPC server             │
└──────────────────────────┘   └──────────────────────────────┘
```

### Ownership boundary

| Concern | Owner |
|---|---|
| Agent identity and parent hierarchy | `edb-subagents` Coordinator |
| Agent conversation/session | Pi `AgentSession` managed by `edb-subagents` |
| Run state | `edb-subagents` Coordinator |
| Questions and escalation | `edb-subagents` Coordinator |
| Mailbox priority and delivery | `edb-subagents` Coordinator |
| Desired linked-task transitions | `edb-subagents` Coordinator |
| Accepted task state and validation | `edb-todo` |
| Task persistence | `edb-todo` |
| Task dependency graph | `edb-todo` |
| Task widget | `edb-todo` |
| Agent widget/tree | `edb-subagents` |

`edb-subagents` must never read or write the todo file directly.

---

## 5. Package strategy

### 5.1 `packages/edb-subagents`

Build V2 in parallel under `src/v2` while the current entry point remains active.

```text
packages/edb-subagents/
├── src/
│   ├── index.ts                         # Existing V1 entry until cutover
│   └── v2/
│       ├── index.ts                     # V2 Pi extension composition root
│       ├── types.ts
│       ├── errors.ts
│       ├── settings.ts
│       │
│       ├── coordinator/
│       │   ├── coordinator.ts
│       │   ├── state-machine.ts
│       │   ├── agent-registry.ts
│       │   ├── run-queue.ts
│       │   ├── mailbox.ts
│       │   ├── wait-links.ts
│       │   └── permissions.ts
│       │
│       ├── runtime/
│       │   ├── runtime.ts
│       │   ├── runtime-pool.ts
│       │   ├── session-factory.ts
│       │   ├── root-adapter.ts
│       │   ├── child-adapter.ts
│       │   └── run-control.ts
│       │
│       ├── questions/
│       │   ├── question-service.ts
│       │   └── human-adapter.ts
│       │
│       ├── persistence/
│       │   ├── atomic-store.ts
│       │   ├── schema.ts
│       │   ├── outbox.ts
│       │   ├── recovery.ts
│       │   └── retention.ts
│       │
│       ├── integrations/
│       │   └── todo-client.ts
│       │
│       ├── tools/
│       │   ├── agent-tool.ts
│       │   ├── get-result-tool.ts
│       │   ├── send-tool.ts
│       │   ├── steer-tool.ts
│       │   ├── stop-tool.ts
│       │   ├── question-tools.ts
│       │   ├── progress-tool.ts
│       │   └── task-proxy-tools.ts
│       │
│       ├── prompts/
│       │   ├── child-system-prompt.ts
│       │   └── internal-messages.ts
│       │
│       └── ui/
│           ├── agent-widget.ts
│           └── commands.ts
└── test/v2/
    ├── state-machine.test.ts
    ├── coordinator.test.ts
    ├── recursive-agents.test.ts
    ├── logical-wait.test.ts
    ├── questions.test.ts
    ├── mailbox.test.ts
    ├── persistence.test.ts
    ├── recovery.test.ts
    ├── todo-client.test.ts
    ├── permissions.test.ts
    ├── shutdown.test.ts
    └── sdk-integration.test.ts
```

### 5.2 `packages/edb-todo`

Keep the package standalone. Extract one application service so tools, UI integration and RPC use the same validation path.

```text
packages/edb-todo/src/
├── task-service.ts                      # New application API
├── rpc/
│   ├── server.ts                        # Versioned request handling
│   └── capability.ts                    # Session instance/nonce handling
├── file-store.ts                        # Existing store, hardened
├── index.ts                             # Registers tools and RPC server
└── ...existing UI and types
```

### 5.3 `packages/edb-protocol`

Create a tiny normal TypeScript package. It is not a Pi extension and has no Pi manifest.

```text
packages/edb-protocol/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    └── todo-v1.ts
```

It contains only protocol constants, TypeScript types and runtime validators. Both `edb-subagents` and `edb-todo` depend on it.

### 5.4 `packages/edb-bridge`

Do not delete it during the V2 implementation. Remove every V2 dependency on it and document that it is not part of in-process orchestration. Decide separately whether to deprecate or harden it for genuine cross-process use.

---

## 6. Domain model

Use opaque string aliases for IDs. IDs are generated only by the coordinator.

```ts
export type AgentId = string;
export type RunId = string;
export type QuestionId = string;
export type MessageId = string;
export type WaitLinkId = string;
export type OperationId = string;
```

Recommended ID prefixes:

```text
agt_<uuid>   agent
run_<uuid>   run
qst_<uuid>   question
msg_<uuid>   mailbox/outbox event
wait_<uuid>  wait link
op_<uuid>    idempotent external operation
```

The root agent uses the reserved ID `root`.

### 6.1 Agent record

An agent is a reusable identity and persistent conversation, not one invocation.

```ts
interface AgentRecord {
  id: AgentId;
  parentAgentId: AgentId | null;
  createdByRunId: RunId | null;

  type: string;
  displayName: string;
  description?: string;

  sessionFile: string | null;
  cwd: string;

  state:
    | "created"
    | "idle"
    | "queued"
    | "running"
    | "waiting_parent"
    | "waiting_child"
    | "stopping"
    | "error"
    | "disposed";

  currentRunId: RunId | null;
  childAgentIds: AgentId[];

  model?: string;
  thinking?: string;
  maxTurns?: number;
  toolProfile: string;

  createdAt: string;
  updatedAt: string;
  lastActiveAt: string | null;
  disposedAt: string | null;
}
```

### 6.2 Run record

One logical unit of work. A run may contain multiple prompt segments when it waits and later resumes.

```ts
interface RunRecord {
  id: RunId;
  agentId: AgentId;
  parentRunId: RunId | null;
  requestedByAgentId: AgentId;

  taskId: string | null;
  mode: "foreground" | "background" | "followup" | "internal";

  state:
    | "queued"
    | "running"
    | "waiting_parent"
    | "waiting_child"
    | "completed"
    | "failed"
    | "cancelled"
    | "timed_out"
    | "interrupted";

  prompt: string;
  segmentCount: number;
  waitingOnRunIds: RunId[];
  pendingQuestionId: QuestionId | null;

  result?: StoredResult;
  error?: StoredError;
  stopReason?: AbortReason;

  taskSyncPending: boolean;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
}
```

### 6.3 Stored result

```ts
interface StoredResult {
  text: string;
  truncated: boolean;
  storedBytes: number;
  originalBytes?: number;
  sessionFile: string;
  finalMessageId?: string;
}
```

Truncation must preserve valid UTF-8. The structured metadata must never be truncated.

### 6.4 Question record

```ts
interface QuestionRecord {
  id: QuestionId;
  fromAgentId: AgentId;
  fromRunId: RunId;
  toAgentId: AgentId;

  linkedQuestionId: QuestionId | null;
  taskId: string | null;

  state: "open" | "escalated" | "answered" | "expired" | "cancelled";
  text: string;
  answer: string | null;

  createdAt: string;
  answeredAt: string | null;
  expiresAt: string | null;
}
```

### 6.5 Wait link

A foreground wait is a durable relationship, not a process-local promise.

```ts
interface WaitLink {
  id: WaitLinkId;
  parentAgentId: AgentId;
  parentRunId: RunId | null;
  childAgentId: AgentId;
  childRunId: RunId;
  state: "waiting" | "question_delivered" | "result_delivered" | "cancelled";
  createdAt: string;
  updatedAt: string;
}
```

For the root Pi agent, `parentRunId` may be null because Pi owns the root conversation run. The wait link still records the child relationship.

### 6.6 Mailbox message

```ts
interface MailboxMessage {
  id: MessageId;
  recipientAgentId: AgentId;
  senderAgentId: AgentId | "coordinator";
  kind:
    | "child_question"
    | "child_completed"
    | "child_failed"
    | "child_cancelled"
    | "parent_answer"
    | "steer"
    | "followup"
    | "stop"
    | "timeout"
    | "system";
  priority: 0 | 1 | 2 | 3;
  payload: unknown;
  state: "pending" | "delivering" | "delivered" | "consumed" | "failed";
  createdAt: string;
  deliveredAt: string | null;
}
```

Priority order:

| Priority | Messages |
|---:|---|
| 0 | stop, shutdown, timeout |
| 1 | parent answer, child question |
| 2 | steer, child terminal result |
| 3 | ordinary follow-up, progress, system notice |

---

## 7. State-machine requirements

All state changes must pass through explicit pure transition functions. Do not assign state fields ad hoc in tools or UI code.

### 7.1 Agent transition matrix

| Current | Event | Next | Allowed |
|---|---|---|---|
| created | session_ready | idle | yes |
| idle | enqueue_run | queued | yes |
| queued | prompt_segment_start | running | yes |
| running | ask_parent | waiting_parent | yes |
| running | wait_for_child | waiting_child | yes |
| running | run_complete | idle | yes |
| running | run_fail | error or idle | yes; agent remains reusable |
| waiting_parent | answer_received | queued | yes |
| waiting_parent | stop | stopping | yes |
| waiting_child | child_event | queued | yes |
| waiting_child | stop | stopping | yes |
| error | followup | queued | yes |
| idle/error | dispose | disposed | yes |
| disposed | any execution event | unchanged | no |

A failed run must not permanently destroy an agent. The agent normally returns to `idle` with the failed run retained. Use `error` only for an unusable runtime/session condition.

### 7.2 Run transition matrix

| Current | Event | Next |
|---|---|---|
| queued | prompt_segment_start | running |
| running | ask_parent | waiting_parent |
| running | foreground_child_started | waiting_child |
| running | final_result | completed |
| running | runtime_error | failed |
| running | cancel | cancelled |
| running | timeout | timed_out |
| waiting_parent | answer_received | queued |
| waiting_parent | cancel | cancelled |
| waiting_parent | timeout | timed_out |
| waiting_child | child_question | queued |
| waiting_child | child_terminal | queued |
| waiting_child | cancel | cancelled |
| queued/running/waiting_* | shutdown | interrupted |
| terminal | followup | create a new Run; never reopen terminal Run |

A resumed question continues the same logical run. A user follow-up after terminal completion creates a new run against the same agent session.

### 7.3 Abort reasons

Never infer intent from `AbortError` alone.

```ts
type AbortReason =
  | "suspend_for_question"
  | "suspend_for_child"
  | "cancelled_by_parent"
  | "cancelled_by_human"
  | "timeout"
  | "shutdown"
  | "runtime_error";
```

Persist the abort reason before invoking `session.abort()`. Normal logical waits should end through `terminate: true`; tagged abort is a controlled fallback for parallel-tool batches or shutdown.

### 7.4 Invalid transitions

An invalid transition must:

1. Leave persisted state unchanged.
2. Return a typed `InvalidTransitionError`.
3. Include entity ID, current state and requested event.
4. Never be silently ignored.
5. Be covered by a unit test.

---

## 8. Coordinator interface

The coordinator is the only API tools and runtimes may call.

```ts
interface Coordinator {
  start(): Promise<void>;
  shutdown(reason: "session_shutdown" | "process_exit"): Promise<void>;

  spawn(caller: CallerContext, input: SpawnInput): Promise<SpawnReceipt>;
  getAgent(caller: CallerContext, agentId: AgentId): AgentView;
  getRun(caller: CallerContext, runId: RunId): RunView;

  registerWait(caller: CallerContext, runId: RunId): Promise<WaitReceipt>;
  cancelWait(caller: CallerContext, waitLinkId: WaitLinkId): Promise<void>;

  sendFollowup(caller: CallerContext, agentId: AgentId, text: string): Promise<RunReceipt>;
  steer(caller: CallerContext, agentId: AgentId, text: string): Promise<void>;
  stop(caller: CallerContext, agentId: AgentId, reason?: string): Promise<void>;

  askParent(caller: CallerContext, input: AskParentInput): Promise<QuestionReceipt>;
  answerChild(caller: CallerContext, input: AnswerChildInput): Promise<AnswerReceipt>;

  reportProgress(caller: CallerContext, input: ProgressInput): Promise<void>;

  createTaskProxyTools(agentId: AgentId): CustomTool[];
  createAgentTools(agentId: AgentId): CustomTool[];
}
```

### Caller context

Caller identity is created by the tool closure, never accepted from model input.

```ts
interface CallerContext {
  agentId: AgentId;
  runId: RunId | null;
  rootSessionId: string;
  abortSignal: AbortSignal;
}
```

### Coordinator invariants

1. One `AgentId` is used for registry, runtime, questions, task ownership, UI and persistence.
2. An agent has at most one active run.
3. A session has at most one active `prompt()` segment.
4. A run may wait on children without holding a run-queue permit.
5. Every child has exactly one parent except `root`.
6. Parent hierarchy is immutable after creation.
7. Only a direct parent may answer a child question.
8. Root may inspect or stop any descendant.
9. Children may manage only their descendants, never parents or siblings.
10. Every external side effect has an operation/event ID.
11. State is persisted before notification or RPC delivery.
12. Replayed external operations are idempotent.

---

## 9. Concurrency and scheduling

This scheduler controls current model prompt segments only. It is not a cron scheduler.

### Defaults

| Limit | Default |
|---|---:|
| Global active prompt segments | 4 |
| Active direct children per parent | 2 |
| Maximum hierarchy depth | 4 |
| Maximum active descendants per root | 16 |
| Foreground wait timeout | 30 minutes |
| Background run timeout | Configurable; default none |
| Runtime idle eviction | 10 minutes |

### Permit behavior

Acquire a permit immediately before invoking a child `session.prompt()` segment. Release it when that segment:

- completes,
- terminates for a logical wait,
- asks its parent,
- is aborted,
- fails,
- or times out.

Never hold a permit while a run is `waiting_parent` or `waiting_child`.

### Queue requirements

- FIFO within equal priority.
- Resuming an answered question has higher priority than new background work.
- Do not use any `bypassQueue` option.
- Prevent starvation by aging queued work.
- Cancellation removes queued entries atomically.
- Queue changes are persisted before a runtime starts.

### Required deadlock test

With global concurrency set to `1`:

1. Root starts child A in foreground.
2. A starts child B in foreground.
3. B asks A a question.
4. A answers.
5. B completes.
6. A completes.
7. Root receives A's result.

The scenario must finish without increasing concurrency.

---

## 10. Pi session runtime

### 10.1 Session construction

Each non-root agent gets one persistent Pi session in a dedicated directory derived from the root session ID.

Recommended layout:

```text
<PI_AGENT_DIR>/subagents/<rootSessionId>/
├── state.json
├── state.json.bak
├── sessions/
│   ├── <agentId>-<piSessionId>.jsonl
│   └── ...
└── diagnostics/
```

Use Pi's exported configuration/path helpers rather than hardcoded `~/.pi` strings. Respect `CONFIG_DIR_NAME` where project configuration is required.

### 10.2 Child ResourceLoader

Create child sessions with:

- no automatic extension discovery,
- no inherited parent extension paths,
- an explicit system prompt,
- an exact built-in tool list,
- coordinator custom tools,
- optional todo proxy tools,
- project-agent definitions only after trust validation.

Do not initialize every parent extension and hide its tools afterward.

### 10.3 Tool profiles

Define profiles as exact allowlists.

Example:

```ts
const TOOL_PROFILES = {
  readonly: ["read", "grep", "find", "ls"],
  researcher: ["read", "grep", "find", "ls"],
  coder: ["read", "grep", "find", "ls", "edit", "write", "bash"],
  tester: ["read", "grep", "find", "ls", "edit", "write", "bash"],
};
```

`bash` is never classified as read-only.

Custom agent definitions may reduce capabilities but may not expand beyond the invoking parent's delegation policy unless the root explicitly permits it.

### 10.4 Runtime lifecycle

```ts
interface AgentRuntime {
  load(agent: AgentRecord): Promise<void>;
  runSegment(run: RunRecord, message: RuntimeMessage): Promise<SegmentOutcome>;
  steer(message: string): Promise<void>;
  abort(reason: AbortReason): Promise<void>;
  unload(): Promise<void>;
  dispose(): Promise<void>;
}
```

Rules:

- `load()` may reopen the stored session file.
- `runSegment()` cannot run concurrently with itself.
- `unload()` is allowed only for `idle` agents during initial V2.
- Never unload `waiting_parent` or `waiting_child` runtimes until Phase 0 proves the suspended transcript is safely reopenable.
- `dispose()` is idempotent.
- A runtime failure must not delete its session file.
- Session files are retained until explicit agent disposal or retention cleanup.

### 10.5 Controlled yield

`ask_parent` and foreground waiting tools return `terminate: true` and set a reason-tagged `RunControl` sentinel.

```ts
interface RunControl {
  requestedYield: null | {
    reason: "question" | "child_wait";
    entityId: QuestionId | WaitLinkId;
  };
  abortReason: AbortReason | null;
}
```

After `session.prompt()` resolves, runtime classification checks `RunControl` before interpreting the result as completed or failed.

If the model issued `ask_parent` in a parallel tool batch and Pi does not terminate the segment, the runtime may invoke `session.abort()` only after persisting `suspend_for_question`.

This exact behavior is a Phase 0 hard gate.

---

## 11. Tool contracts

Preserve familiar public names where practical. Root and child agents receive the same recursion-capable agent tools.

### 11.1 `Agent`

```ts
interface AgentInput {
  prompt: string;
  description: string;
  subagent_type: string;
  run_in_background?: boolean;
  model?: string;
  thinking?: string;
  max_turns?: number;
  task_id?: string;
  agent_name?: string;
}
```

Behavior:

- Caller ID is implicit.
- Validate depth, descendant count, capabilities and todo availability.
- Generate canonical agent and run IDs.
- If `task_id` is provided, persist a todo assignment intent before starting.
- Background mode returns immediately and does not terminate the caller segment.
- Foreground mode creates a `WaitLink`, sets caller run to `waiting_child`, and returns `terminate: true`.

Foreground tool result:

```json
{
  "status": "waiting",
  "agentId": "agt_...",
  "runId": "run_...",
  "waitLinkId": "wait_...",
  "resume": "automatic"
}
```

Background tool result:

```json
{
  "status": "queued",
  "agentId": "agt_...",
  "runId": "run_..."
}
```

### 11.2 `get_subagent_result`

Inputs:

```ts
interface GetResultInput {
  agent_id: AgentId;
  run_id?: RunId;
  wait?: boolean;
  include_transcript?: boolean;
}
```

Behavior:

- Return terminal results immediately.
- If nonterminal and `wait` is false, return current state.
- If nonterminal and `wait` is true, create a wait link, logically suspend the caller and resume it later.
- Transcript output is independently bounded.
- Queued, running and waiting states are all valid nonterminal states.

### 11.3 `steer_subagent`

- Allowed only for a running direct descendant.
- Uses `session.steer()` at Pi's safe boundary.
- If queued, return a typed error directing the caller to use follow-up.
- If waiting on a parent, do not replace the pending parent answer.
- A stop/timeout mailbox message outranks steering.

### 11.4 `send_to_agent`

- Creates a new run against the same agent when the agent is idle or terminal from a previous run.
- If the agent is currently running, enqueue a follow-up only if the caller requests it explicitly.
- If the agent is waiting on a question, enqueue after the parent-answer message.
- Preserve the existing persistent session.
- Support background or logical foreground mode.

### 11.5 `stop_subagent`

- Parent may stop a direct descendant; root may stop any descendant.
- Persist `cancelled_by_parent` before aborting a runtime.
- Cancel queued descendants according to a defined policy. Default: cancel the selected agent's active run and all active descendants.
- Never mark a task completed after stop.
- Update linked tasks through the durable todo outbox.

### 11.6 `ask_parent`

```ts
interface AskParentInput {
  question: string;
  for_question_id?: QuestionId;
  task_id?: string;
  timeout_ms?: number;
}
```

Behavior:

1. Verify the caller has a parent, or route root to the human adapter.
2. Create and persist the question.
3. Set run/agent to `waiting_parent`.
4. Enqueue task-block intent if linked.
5. Enqueue a parent mailbox event.
6. Set `RunControl.requestedYield`.
7. Return `terminate: true`.

System prompts must explicitly instruct agents that `ask_parent` is a yielding tool and should be the final/sole tool call in the batch.

### 11.7 `answer_child`

```ts
interface AnswerChildInput {
  question_id: QuestionId;
  answer: string;
  detach?: boolean;
}
```

Behavior:

- Verify the question is open and addressed to the caller.
- Reject sibling, ancestor and expired-question answers.
- Persist the answer and child resume mailbox message.
- Enqueue task-unblock intent.
- Resume the same child session/run.
- If the caller was foreground-waiting on that child and `detach` is false, restore caller to `waiting_child` and return `terminate: true`.
- Otherwise acknowledge and allow the caller to continue.

### 11.8 `report_progress`

- Store a bounded progress message.
- Update agent UI.
- Optionally send a low-priority parent notification.
- Never trigger a new parent model turn for every progress token/event.

### 11.9 Task proxy tools

When todo integration is available, children receive proxy versions of:

- `TaskCreate`
- `TaskList`
- `TaskGet`
- `TaskUpdate`

The proxy binds `agentId`, `runId` and `rootSessionId`. The model cannot supply another actor identity.

When todo integration is unavailable, omit these tools entirely. If a spawn includes `task_id`, reject before creating the child.

---

## 12. Parent/child workflows

### 12.1 Foreground completion

```text
Parent             Coordinator               Child Runtime
  │                     │                          │
  │ Agent(wait)         │                          │
  ├────────────────────►│ create agent/run/wait   │
  │ waiting result      │                          │
  │ terminate segment   │                          │
  │                     ├─────────────────────────►│ run segment
  │                     │                          │
  │                     │◄─────────────────────────┤ completed
  │                     │ persist result           │
  │                     │ enqueue parent event     │
  │◄────────────────────┤ resume with result       │
  │ new prompt segment  │                          │
```

The parent run remains logically open while `waiting_child`. It is not marked completed when the original prompt segment terminates.

### 12.2 Foreground child question

```text
Parent             Coordinator               Child
  │                     │                       │
  │ Agent(wait)         │                       │
  ├────────────────────►│                       │
  │ segment terminates  ├──────────────────────►│ run
  │                     │                       │
  │                     │◄──────────────────────┤ ask_parent(Q)
  │                     │ child waiting_parent  │ segment terminates
  │◄────────────────────┤ resume parent with Q  │
  │ answer_child(Q)     │                       │
  ├────────────────────►│ persist answer         │
  │ waiting_child       ├──────────────────────►│ resume same run
  │ segment terminates  │                       │
  │                     │◄──────────────────────┤ completed
  │◄────────────────────┤ resume with result     │
```

### 12.3 Background question

If a background child asks a question:

- If parent is idle, start an internal question-handling segment.
- If parent is running, enqueue the question at priority 1.
- If parent is waiting on another child, enqueue deterministically; do not mutate the unrelated wait link.
- For root, use Pi follow-up delivery with `triggerTurn` only after the current root turn is safe to continue.
- The question remains visible through UI and result tools until answered or expired.

### 12.4 Nested escalation

```text
Grandchild          Parent Agent          Root Agent             Human
    │ ask_parent Q1      │                    │                     │
    ├───────────────────►│                    │                     │
    │ waiting            │ cannot answer      │                     │
    │                    │ ask_parent Q2       │                     │
    │                    ├───────────────────►│                     │
    │                    │ waiting             │ asks human          │
    │                    │                    ├────────────────────►│
    │                    │                    │◄────────────────────┤
    │                    │◄───────────────────┤ answer Q2            │
    │◄───────────────────┤ answer Q1           │                     │
    │ resumes            │                    │                     │
```

Each escalation creates a linked question. Do not forward an answer directly past an intermediate agent. The intermediate parent resumes, interprets the answer and explicitly answers its child.

---

## 13. Human interaction

### TUI mode

Root `ask_parent` maps to a human adapter using Pi UI facilities. The prompt must show:

- originating agent,
- agent hierarchy path,
- linked task,
- original question,
- intermediate context,
- question ID.

The result is returned to the root agent, which may then answer its child.

### Headless/RPC mode

If no UI is available:

1. Keep the question open.
2. Return or emit a structured `human_required` event.
3. Show it through `/agents questions` when a TUI reconnects.
4. Permit the root agent to answer it after receiving human input in a later conversation turn.
5. Never fabricate an empty answer or automatically fail immediately.

### Question timeout

Timeout policy is explicit:

- Mark question expired.
- Mark waiting run timed out or detach it according to configuration.
- Send a timeout event to the parent.
- Enqueue a todo transition from blocked to failed/timed-out state.
- Ignore late answers with a typed error.

---

## 14. Todo integration protocol

### 14.1 Protocol transport

Use the root Pi event bus only. Child sessions do not receive or use this bus; they call the coordinator through tool closures.

Base events:

```text
edb:todo:v1:discover
edb:todo:v1:ready
edb:todo:v1:<instanceNonce>:request
edb:todo:v1:<instanceNonce>:response
```

`edb-todo` generates a random instance nonce per root session. The nonce prevents stale responses, multiple-instance confusion and accidental namespace collisions. It is not a security sandbox: all in-process extensions are trusted code and can observe the event bus.

Every request validates:

- protocol version,
- root session ID,
- todo instance nonce,
- request ID,
- operation ID for mutations,
- actor identity supplied by the coordinator,
- method schema,
- parameter schema.

### 14.2 Request

```ts
interface TodoRequestV1<M extends TodoMethod = TodoMethod> {
  protocolVersion: 1;
  requestId: string;
  operationId?: OperationId;
  rootSessionId: string;
  instanceNonce: string;
  method: M;
  actor: {
    agentId: AgentId;
    runId: RunId | null;
  };
  params: TodoParams[M];
}
```

### 14.3 Response

```ts
interface TodoResponseV1 {
  protocolVersion: 1;
  requestId: string;
  operationId?: OperationId;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

### 14.4 Methods

```ts
type TodoMethod =
  | "capabilities"
  | "create"
  | "createMany"
  | "list"
  | "get"
  | "update"
  | "assign"
  | "block"
  | "unblock";
```

### 14.5 Task service

Extract a single `TaskService` inside `edb-todo`:

```ts
interface TaskService {
  create(input: CreateTaskInput, actor: TaskActor): Promise<Task>;
  createMany(inputs: CreateTaskInput[], actor: TaskActor): Promise<Task[]>;
  list(query: TaskQuery, actor: TaskActor): Promise<Task[]>;
  get(taskId: string, actor: TaskActor): Promise<Task | undefined>;
  update(taskId: string, patch: TaskPatch, actor: TaskActor): Promise<Task>;
  assign(taskId: string, owner: TaskOwner, actor: TaskActor): Promise<Task>;
  block(taskId: string, question: TaskQuestionLink, actor: TaskActor): Promise<Task>;
  unblock(taskId: string, questionId: string, actor: TaskActor): Promise<Task>;
}
```

Existing todo tools and the RPC server call this service. Do not duplicate validation in the RPC layer.

### 14.6 Todo store hardening required for V2

Before enabling V2 task integration:

- Replace synchronous busy-wait locking with asynchronous lock acquisition.
- Make `createMany` one lock/write transaction.
- Validate self-links and cycles before committing.
- Make task deletion occur under the same lock and current-state read.
- Preserve corrupt files as `.corrupt-<timestamp>` and surface an error; never silently treat corruption as an empty store.
- Add a bounded persisted idempotency ledger for mutation `operationId`s.
- A replay with the same operation ID and same request returns the stored result.
- A replay with the same operation ID and different parameters is rejected.
- Call widget/store cleanup during `session_shutdown`.
- Add explicit `cancelled` and `failed` handling consistently to schemas, prompt and widget.

### 14.7 Todo availability

- Coordinator discovers todo during `session_start` with a bounded handshake timeout.
- `edb-todo` emits `ready` after its RPC server is installed.
- Coordinator listens for later `ready` events so todo can appear after initial startup.
- If todo disappears, new linked operations fail fast.
- Already persisted outbox operations remain pending and retry with backoff when the same root-session todo service returns.
- Never fall back to reading the task file.

---

## 15. Task lifecycle

### Task ownership

When spawning with `task_id`:

1. Persist agent/run and desired task assignment.
2. Enqueue `assign(taskId, agentId, runId)`.
3. Enqueue status `in_progress`.
4. Start the child only after todo accepts, unless configured for task-degraded mode.
5. Default V2 behavior is strict: a task-linked spawn fails if assignment fails.

### State mapping

| Agent/run event | Desired task transition |
|---|---|
| Task-linked run queued/started | `in_progress`, owner = agent |
| Agent asks parent | `blocked`, include question ID/text |
| Parent answers | `in_progress`, clear matching question block |
| Run truly completes | `completed` if auto-complete enabled |
| Run fails | `failed` |
| Run cancelled | `cancelled` |
| Run timed out | `failed` with timeout metadata |
| Follow-up on completed task | `in_progress` |
| Progress report | update active form/metadata only |

Never mark a task completed for:

- `waiting_parent`,
- `waiting_child`,
- aborted suspension,
- cancellation,
- timeout,
- shutdown interruption,
- runtime disposal.

### Authority boundary

Coordinator stores the desired task transition and synchronization status. `edb-todo` owns the accepted persisted task state. UI should show `taskSyncPending` when desired and accepted states may differ.

---

## 16. Persistence

### 16.1 Coordinator snapshot

```ts
interface CoordinatorSnapshotV1 {
  schemaVersion: 1;
  rootSessionId: string;
  cwd: string;
  revision: number;
  agents: Record<AgentId, AgentRecord>;
  runs: Record<RunId, RunRecord>;
  questions: Record<QuestionId, QuestionRecord>;
  waitLinks: Record<WaitLinkId, WaitLink>;
  mailbox: MailboxMessage[];
  outbox: OutboxOperation[];
  updatedAt: string;
}
```

### 16.2 Atomic write algorithm

All snapshot writes go through one async persistence queue.

1. Serialize and validate the complete next snapshot.
2. Write to `state.json.tmp-<pid>-<revision>`.
3. Flush the file.
4. Preserve the last valid snapshot as `state.json.bak`.
5. Atomically rename temporary file to `state.json`.
6. Flush the containing directory when supported.
7. Update in-memory committed revision only after rename succeeds.
8. Clean abandoned temporary files during startup after validation.

Do not busy-wait.

### 16.3 Durable outbox

External effects are persisted before delivery.

```ts
interface OutboxOperation {
  id: OperationId;
  kind: "todo_rpc" | "root_message" | "agent_message";
  payload: unknown;
  state: "pending" | "delivering" | "delivered" | "failed";
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;
  createdAt: string;
  deliveredAt?: string;
}
```

Processing rules:

- Delivery is at least once.
- Todo mutations are idempotent by `operationId`.
- Agent mailbox delivery is idempotent by `MessageId`.
- Root Pi message delivery may have a narrow duplicate window; include event IDs in every internal message and record successful API return before pruning.
- Backoff is bounded and includes jitter.
- Permanent schema/permission failures are not retried forever.
- Failed operations remain visible through diagnostics.

### 16.4 Session/coordinator consistency

Pi session JSONL and coordinator JSON cannot be one transaction. Use correlation IDs in internal messages and run segments.

Before sending a resume message:

1. Persist mailbox/outbox operation.
2. Mark the target run queued.
3. Deliver a message containing `messageId`, `runId`, `questionId` or child outcome ID.
4. On segment completion, mark the message consumed.

On recovery, inspect the target session branch for the correlation marker where practical. Otherwise use at-least-once delivery and make coordinator operations idempotent.

### 16.5 Retention

Default retention:

- Keep all active agents/runs/questions.
- Keep the latest 200 terminal runs per root session.
- Keep terminal run summaries for 30 days.
- Keep session JSONL until agent disposal or configured age expiry.
- Keep at most 500 consumed mailbox messages.
- Never remove a session with open questions or pending outbox work.

---

## 17. Recovery

### Startup sequence

1. Establish root session ID and state directory.
2. Load `state.json`; validate schema and revision.
3. If invalid, validate `state.json.bak`.
4. Preserve invalid files for diagnosis; never silently initialize over them.
5. Reconcile agent records with session files.
6. Convert runs that were `running` or `queued` during crash to `interrupted`.
7. Preserve `waiting_parent` questions as open.
8. Keep their runtimes pinned/unloaded according to Phase 0 support.
9. Mark agents from interrupted runs reusable/idle unless session validation fails.
10. Rebuild pending mailbox/outbox queues.
11. Discover todo and replay idempotent task operations.
12. Surface a recovery summary to the root UI.

### Recovery policy by state

| Previous state | Recovery |
|---|---|
| idle | reopen lazily |
| queued | run becomes interrupted; do not silently rerun model side effects |
| running | run becomes interrupted |
| waiting_parent | preserve question and waiting state if session can reopen safely |
| waiting_child | reconcile child's state; deliver terminal child event if available, otherwise mark interrupted |
| stopping | complete cancellation reconciliation |
| disposed | remain disposed |

Never automatically replay an LLM run after a crash. It may have executed tools before the crash. Resume only by explicit parent/human follow-up.

### Corruption policy

- Do not overwrite corrupt coordinator state.
- Copy it to `state.json.corrupt-<timestamp>`.
- Attempt validated backup recovery.
- If both current and backup are invalid, disable V2 for the session and report a recovery error with file paths.

---

## 18. Shutdown

Register one idempotent `session_shutdown` handler.

Order:

1. Set coordinator to `shutting_down`; reject new spawns/follow-ups.
2. Stop queue admission.
3. Cancel pending timers and retry loops.
4. Persist `shutdown` abort reasons for active prompt segments.
5. Abort active runtimes.
6. Wait for a bounded grace period.
7. Mark unresolved active runs `interrupted`.
8. Reject process-local wait handles without altering durable wait links incorrectly.
9. Persist final snapshot/outbox.
10. Dispose child runtimes.
11. Remove Pi event-bus listeners.
12. Dispose agent widget and commands.
13. Release todo RPC response listeners.
14. Mark shutdown complete.

Every cleanup method must be safe to call more than once.

Open questions remain visible after restart. Shutdown must not convert them to completed or answered.

---

## 19. Security and capability boundaries

### Project trust

- Load user-level agent definitions normally.
- Read project `.pi/agents` only after `ctx.isProjectTrusted()` returns true.
- Default to user agents only if trust cannot be determined.
- Do not execute project-supplied agent prompts during extension initialization before trust exists.

### Delegation permissions

- Caller identity comes from closures.
- Child can create direct children.
- Child can inspect/steer/stop only descendants.
- Child cannot answer a sibling's question.
- Child cannot forge `linkedQuestionId` from another branch.
- Root can manage all agents.
- Tool profiles are intersected with parent delegation policy.
- Subagents cannot add arbitrary extensions or tools.

### In-process trust limitation

All loaded Pi extensions execute in one Node.js process. A malicious loaded extension cannot be fully isolated by event-bus tokens. Todo instance nonces protect correctness and accidental cross-session delivery, not hostile code. The real boundary is Pi project trust and explicit extension loading.

### Input limits

Validate and cap:

- prompt size,
- question size,
- progress message size,
- result size,
- recursion depth,
- total descendants,
- queued messages,
- outbox retries,
- todo RPC payload size.

---

## 20. Configuration

Add a small V2 settings schema. Avoid copying all V1 settings.

```ts
interface SubagentsV2Settings {
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
```

Defaults:

```json
{
  "engine": "v1",
  "maxConcurrentPrompts": 4,
  "maxChildrenPerParent": 2,
  "maxDepth": 4,
  "maxActiveDescendants": 16,
  "foregroundWaitTimeoutMs": 1800000,
  "idleRuntimeEvictionMs": 600000,
  "maxResultBytes": 51200,
  "maxTranscriptBytes": 102400,
  "autoCompleteLinkedTasks": true,
  "projectAgents": "trusted",
  "retentionDays": 30
}
```

Use opt-in V2 during development and soak. Change the default only after release gates pass.

---

## 21. UI and commands

### Agent widget

Show a compact hierarchy without duplicating the todo widget.

```text
Agents 2 running · 1 waiting · 3 idle
├─ [A12] coder       running       task t14
│  └─ [A13] tester   waiting Q7    task t15
└─ [A14] researcher  idle          last 2m
```

Use canonical IDs internally and short display suffixes only in UI.

### Commands

Implement:

```text
/agents
/agents tree
/agents questions
/agents show <agentId>
/agents stop <agentId>
/agents dispose <agentId>
/agents recovery
/agents outbox
```

Commands are management surfaces; tools remain the model API.

### Notifications

- Foreground child result resumes the waiting parent.
- Background completion enters the parent mailbox.
- Do not interrupt an active tool batch.
- Questions have higher priority than completions.
- Batch low-priority progress notifications.
- Every notification includes agent ID, run ID and linked task ID.

---

## 22. Phase 0 — mandatory Pi SDK validation

Do not implement the full coordinator until these spikes pass.

Create focused tests/prototypes under `packages/edb-subagents/test/v2/spikes/`.

### Spike A: persistent child reopen

Prove:

1. Create a child `AgentSession` with persistent `SessionManager`.
2. Prompt it and record a known fact.
3. Dispose/unload it.
4. Reopen using the stored session file.
5. Ask a follow-up.
6. Verify it retains context and accepts tools normally.

Pass criteria:

- No duplicate extension initialization.
- Same session branch/context is used.
- Session file is valid after dispose/reopen.

### Spike B: yielding tool and resume

Prove:

1. Child calls a custom `ask_parent` tool.
2. Tool returns `terminate: true`.
3. Prompt segment resolves without being classified as successful final completion.
4. Coordinator marks it waiting.
5. Resume the same session with an answer message.
6. Child continues coherently.

Inspect the exact session transcript before and after resume.

### Spike C: parallel-tool yield

Prove behavior when the model calls `ask_parent` alongside another tool.

Required result:

- Persist reason-tagged suspension.
- Stop further model turns.
- Preserve a reopenable session.
- Resume coherently after answer.

If `terminate: true` is insufficient, validate tagged `session.abort()`.

### Spike D: root logical wait

Prove:

1. Root tool returns `terminate: true` after registering a wait link.
2. Root turn ends.
3. Extension later uses Pi message delivery to resume root with a structured result.
4. The root model understands this as continuation of the wait.

### Spike E: concurrency one recursion

Use deterministic fake runtimes to prove a waiting parent releases its permit and a child/grandchild can run with global concurrency one.

### Hard gate outcomes

| Outcome | Action |
|---|---|
| Same session yield/resume works | Continue as designed. |
| Session must be reopened after controlled abort | Implement runtime rotation while preserving Agent ID and update `sessionFile`. |
| Pi cannot stop post-question continuation or safely resume context | Stop implementation and redesign the execution adapter before Phase 1. Do not improvise inside later phases. |

Document spike results in `docs/subagents-v2-sdk-validation.md`.

---

## 23. Implementation phases

Each phase must finish with passing tests and no unresolved TypeScript errors before the next starts.

### Phase 1 — protocol and todo application boundary

**Create:**

- `packages/edb-protocol/package.json`
- `packages/edb-protocol/tsconfig.json`
- `packages/edb-protocol/src/index.ts`
- `packages/edb-protocol/src/todo-v1.ts`
- `packages/edb-todo/src/task-service.ts`
- `packages/edb-todo/src/rpc/server.ts`
- `packages/edb-todo/src/rpc/capability.ts`

**Modify:**

- root workspace/package configuration for the new package
- `packages/edb-todo/package.json`
- `packages/edb-todo/src/index.ts`
- `packages/edb-todo/src/file-store.ts`
- todo schemas/types/UI for failed/cancelled consistency

**Work:**

1. Define and validate RPC V1.
2. Extract `TaskService` from tool handlers.
3. Route existing todo tools through `TaskService` without changing public behavior.
4. Add RPC server on root event bus.
5. Add async file locking and transactional `createMany`.
6. Add precommit dependency validation.
7. Add operation idempotency ledger.
8. Add corruption preservation and shutdown cleanup.

**Acceptance:**

- Existing todo behavior remains available standalone.
- Tools and RPC produce identical validation/results.
- No synchronous busy-wait remains.
- Duplicate create operation does not create duplicate tasks.
- Cycles/self-dependencies are rejected before write.
- Corrupt data is preserved and reported.

### Phase 2 — pure coordinator core

**Create:**

- `src/v2/types.ts`
- `src/v2/errors.ts`
- all `src/v2/coordinator/*`
- pure unit tests

**Work:**

1. Implement ID generation.
2. Implement state transition functions.
3. Implement hierarchy and permission checks.
4. Implement run queue and concurrency accounting.
5. Implement priority mailbox.
6. Implement wait links.
7. Implement in-memory coordinator with fake runtime adapter.

**Acceptance:**

- No Pi SDK dependency inside state-machine/registry/queue tests.
- Invalid transitions are typed and side-effect free.
- Global concurrency one recursive scenario completes with fake runtimes.
- Permission tests cover root, parent, descendant, sibling and ancestor cases.

### Phase 3 — atomic persistence and outbox

**Create:**

- all `src/v2/persistence/*`

**Work:**

1. Define snapshot schema and runtime validation.
2. Implement serialized atomic write.
3. Implement backup and corruption policy.
4. Implement durable outbox and backoff.
5. Add retention/pruning.
6. Integrate coordinator commits with persistence.

**Acceptance:**

- Failure injection at every write/rename step preserves a valid old or new snapshot.
- A corrupt current file recovers from valid backup.
- No silent empty initialization on corruption.
- Outbox replay is deterministic and bounded.

### Phase 4 — Pi runtime adapter

**Create:**

- all `src/v2/runtime/*`
- child prompt builder

**Work:**

1. Implement persistent session factory using validated Phase 0 behavior.
2. Implement exact built-in/custom tools.
3. Disable extension discovery in child sessions.
4. Implement prompt segments, classification and reason-tagged abort.
5. Implement runtime pool and idle eviction.
6. Implement output extraction/truncation.

**Acceptance:**

- Same-session follow-up retains context after unload/reopen.
- Waiting runtimes are not evicted unless validated safe.
- No child starts bridge, todo widget, cron or arbitrary extensions.
- `dispose()` leaves no timers, sockets or unhandled rejections.

### Phase 5 — root and recursive agent tools

**Create:**

- `src/v2/tools/agent-tool.ts`
- `get-result-tool.ts`
- `send-tool.ts`
- `steer-tool.ts`
- `stop-tool.ts`
- `progress-tool.ts`

**Work:**

1. Register root tools bound to `root`.
2. Inject the same recursive tools into child sessions.
3. Implement background spawn.
4. Implement logical foreground wait.
5. Implement automatic parent result delivery.
6. Implement follow-up/reuse.
7. Implement steering and cancellation.
8. Enforce hierarchy/concurrency/depth limits.

**Acceptance:**

- Depth-three recursive foreground execution works at concurrency one.
- Background parent continues while child runs.
- Same agent handles multiple follow-up runs with preserved context.
- Parent can steer direct child.
- Child cannot steer sibling or parent.
- Stopping never completes a task.

### Phase 6 — questions and human escalation

**Create:**

- `src/v2/questions/*`
- `src/v2/tools/question-tools.ts`
- internal message templates

**Work:**

1. Implement question records and linkage.
2. Implement child yield.
3. Implement parent mailbox delivery.
4. Implement `answer_child` and automatic child resume.
5. Restore parent foreground wait after answering.
6. Implement nested escalation.
7. Implement TUI and headless human adapters.
8. Implement expiration and races.

**Acceptance:**

- Foreground child asks parent without deadlock.
- Background child wakes parent deterministically.
- Three-level escalation reaches human and unwinds one parent at a time.
- Repeated questions work.
- Late answer after timeout is rejected.
- Stop-vs-answer and timeout-vs-answer resolve exactly once.

### Phase 7 — todo client and task proxies

**Create:**

- `src/v2/integrations/todo-client.ts`
- `src/v2/tools/task-proxy-tools.ts`

**Work:**

1. Implement discovery/ready handshake.
2. Implement validated request/response correlation.
3. Route mutations through durable outbox.
4. Inject task tools only when available.
5. Implement task assignment/block/unblock/terminal transitions.
6. Implement todo restart and retry behavior.

**Acceptance:**

- No child knows a todo file path.
- No child loads the todo extension.
- `task_id` is rejected when todo is unavailable.
- Task ownership shows canonical agent ID.
- Waiting question blocks; answer unblocks; cancellation does not complete.
- Todo restart replays pending operations without duplication.

### Phase 8 — recovery, UI and settings

**Create/modify:**

- `src/v2/persistence/recovery.ts`
- `src/v2/settings.ts`
- `src/v2/ui/*`
- `src/v2/index.ts`

**Work:**

1. Compose extension lifecycle.
2. Add recovery reconciliation.
3. Add agent widget and commands.
4. Add settings and limits.
5. Add project trust gating.
6. Add diagnostics and outbox visibility.
7. Add shutdown lifecycle.

**Acceptance:**

- Startup with interrupted runs gives explicit recovery summary.
- Open questions survive restart when SDK behavior permits.
- No resources remain after shutdown.
- Untrusted project agent definitions are not loaded.
- Widget uses display names but actions use canonical IDs.

### Phase 9 — opt-in integration and soak

**Work:**

1. Add `engine: "v2"` opt-in.
2. Keep current `src/index.ts` defaulting to V1.
3. Run all monorepo tests with V1 and V2.
4. Run published-tarball smoke tests.
5. Use V2 in real nested-agent sessions.
6. Track diagnostics for duplicate events, stuck states and pending outbox work.

**Minimum soak scenarios:**

- 20 sequential reusable follow-ups.
- 20 parallel background children under concurrency four.
- Depth-four recursive execution.
- Repeated nested questions.
- Todo present, absent and restarted.
- Pi shutdown during running, waiting-parent and waiting-child states.

### Phase 10 — cutover and cleanup

Only after all release gates pass:

1. Make V2 the default engine.
2. Keep V1 rollback for one release.
3. Update README and package docs.
4. Mark V1-only settings deprecated.
5. Remove bridge dependency/instructions from subagents.
6. In the following release, delete obsolete V1 manager, schedule, worktree, memory, group-join and cross-extension task code.
7. Do not delete `edb-bridge` package itself without a separate decision.

---

## 24. Testing plan

### 24.1 Unit tests

- Every valid and invalid Agent transition.
- Every valid and invalid Run transition.
- Hierarchy depth and descendant counting.
- Root/parent/child/sibling permissions.
- Queue FIFO, priority, aging and cancellation.
- Permit release on every segment outcome.
- Wait-link create/deliver/cancel lifecycle.
- Mailbox priority and deduplication.
- Question linkage and escalation authorization.
- UTF-8 result truncation.
- Snapshot validation and migration.
- Todo protocol validation.
- Todo mutation idempotency.
- Dependency cycle rejection.

### 24.2 Coordinator integration tests with fake runtime

1. Root foreground child completes.
2. Root background child completes.
3. Child creates grandchild.
4. Foreground child asks parent.
5. Parent answers and automatically waits again.
6. Child asks multiple questions.
7. Background child asks idle parent.
8. Background child asks busy parent.
9. Parent escalates to root.
10. Root escalates to human.
11. Parent steers running child.
12. Parent follows up idle child.
13. Parent stops running/waiting child.
14. Child cannot manage sibling.
15. Concurrency one recursive chain.
16. Multiple waiters on one run; cancelling one does not cancel others.
17. Answer races timeout.
18. Stop races answer.
19. Steer races completion.
20. Follow-up queued behind parent answer.

### 24.3 Pi SDK integration tests

- Persistent session reopen.
- Controlled yield transcript.
- Parallel-tool yield/abort classification.
- Same-session answer resume.
- Root follow-up delivery.
- Steering boundary behavior.
- Session disposal and active-handle cleanup.
- Exact tool allowlist.
- No extension inheritance.
- Project trust behavior.

### 24.4 Persistence failure matrix

Inject crashes/errors:

- before temporary write,
- during temporary write,
- after file flush,
- before backup update,
- before rename,
- after rename before directory flush,
- after coordinator commit before root notification,
- after session message append before coordinator consumed marker,
- after todo RPC success before outbox delivered marker,
- during shutdown snapshot.

For each point assert that recovery is explicit, idempotent and does not fabricate task completion.

### 24.5 Todo RPC tests

- Discovery success and timeout.
- Unknown protocol rejected.
- Wrong root session rejected.
- Wrong instance nonce rejected.
- Malformed actor rejected.
- Unknown method rejected.
- Replayed mutation with same parameters returns same result.
- Replayed operation ID with different parameters rejected.
- Multiple todo instances do not cross-deliver.
- Todo restarts while operations pending.
- Task proxy omitted when unavailable.

### 24.6 Shutdown tests

Run shutdown while:

- idle,
- queued,
- actively prompting,
- waiting for parent,
- waiting for child,
- delivering parent answer,
- processing todo outbox,
- retry timer pending.

Assert:

- no orphan timers,
- no sockets introduced,
- no unhandled rejections,
- final snapshot valid,
- active runs marked interrupted/cancelled correctly,
- open questions preserved,
- task completion not fabricated.

### 24.7 Package/release tests

- TypeScript compile for every workspace package.
- Existing test suites remain green.
- Test declared minimum/current Pi versions.
- `npm pack` each changed package.
- Install tarballs in a clean temporary project.
- Start Pi with only V2 and optionally todo installed.
- Verify no undeclared runtime executable/dependency is required.

---

## 25. Migration and compatibility

### Preserve

- Public package name `@agnishc/edb-subagents`.
- Familiar tool names where possible.
- Existing custom-agent definition basics: description, prompt, tools, model, thinking and max turns.
- Existing `edb-todo` task files through store migrations.
- Existing todo public tools.

### Intentionally remove from V2

- Scheduled invocation fields.
- Worktree fields.
- Arbitrary `extensions: true` inheritance.
- Bridge-based `ask_supervisor` transport.
- Memory subsystem fields.
- Group-join settings.
- Output process tracking.

If compatibility aliases are temporarily required:

- `ask_supervisor` may alias `ask_parent`.
- `answer_subagent` may alias `answer_child`.

Aliases must call the same coordinator methods and emit deprecation warnings. Do not retain the broker implementation behind the alias.

### Existing active agents

V1 agents are in-memory and not safely migratable. On V2 cutover:

- Do not attempt to import running V1 records.
- Require a fresh root session or explicit engine switch.
- Preserve todo tasks and mark any V1 in-progress tasks for user reconciliation rather than auto-completing them.

---

## 26. Observability

Structured diagnostic events should include:

```ts
interface DiagnosticEvent {
  eventId: string;
  type: string;
  rootSessionId: string;
  agentId?: AgentId;
  runId?: RunId;
  questionId?: QuestionId;
  taskId?: string;
  previousState?: string;
  nextState?: string;
  durationMs?: number;
  errorCode?: string;
  timestamp: string;
}
```

Do not log full prompts, answers or secrets by default. Diagnostics should make these failures visible:

- invalid transition,
- duplicate message,
- stalled run,
- stale wait link,
- todo unavailable,
- pending/failed outbox operation,
- runtime/session reopen failure,
- unauthorized descendant operation,
- output truncation,
- recovery action.

---

## 27. Release gates

V2 cannot become default until all are true:

### Architecture

- [ ] One canonical agent ID is used everywhere.
- [ ] Agent identity is separate from run identity.
- [ ] No recursive foreground wait holds a prompt permit.
- [ ] No child has more than one active prompt segment.
- [ ] All state transitions pass through pure state-machine functions.
- [ ] Todo remains a separate optional authority.

### Lifecycle

- [ ] Controlled yield/resume is validated against the target Pi SDK.
- [ ] Persistent follow-up after unload/reopen works.
- [ ] Shutdown is idempotent and leak-free.
- [ ] Recovery never silently replays an interrupted LLM run.
- [ ] Waiting questions are explicit after restart.

### Security

- [ ] Project agents require trusted project context.
- [ ] Children receive exact tool allowlists.
- [ ] Read-only profiles contain no unrestricted shell.
- [ ] Caller identity cannot be supplied by the model.
- [ ] Descendant permissions are tested.

### Tasks

- [ ] Children never access todo files.
- [ ] Todo RPC is versioned and validated.
- [ ] Mutations are idempotent.
- [ ] Task state never becomes completed from wait/cancel/timeout/shutdown.
- [ ] Block/unblock uses matching question IDs.
- [ ] Todo absence is explicit.

### Quality

- [ ] Unit, integration, failure-injection and SDK tests pass.
- [ ] No unhandled promise rejections.
- [ ] No remaining timers/sockets after shutdown tests.
- [ ] Outputs are bounded and indicate truncation.
- [ ] Clean `npm pack` install works.
- [ ] V2 has completed the soak scenarios.

---

## 28. Implementation rules for coding agents

An implementation agent following this plan must:

1. Work phase by phase in order.
2. Treat Phase 0 failure as a blocker, not something to work around silently.
3. Add tests before or with each state-machine/runtime behavior.
4. Keep V1 active until the opt-in V2 integration is complete.
5. Never make `edb-subagents` read the todo store file.
6. Never load full root extensions into child sessions.
7. Never use display names as identifiers.
8. Never change task state outside `edb-todo`'s `TaskService`.
9. Never mark a run/task completed from a generic `finally` block.
10. Never delete a child session/worktree/output on an error path in V2.
11. Persist state before delivering external events.
12. Use operation IDs for retried external mutations.
13. Keep output and mailbox storage bounded.
14. Stop and document any Pi SDK behavior that contradicts this plan.
15. Request an architecture decision before adding a broker, database, scheduler or subprocess backend.

---

## 29. Final acceptance scenario

The implementation is complete only when this full scenario passes automatically:

1. Root creates task `T1`.
2. Root spawns agent A in foreground with `T1`.
3. A becomes owner of `T1`; `T1` is in progress.
4. A creates task `T2` through todo proxy.
5. A spawns agent B in foreground with `T2` while global concurrency is one.
6. B becomes owner of `T2`.
7. B asks A a question.
8. `T2` becomes blocked.
9. A does not know and asks root.
10. Root does not know and asks the human.
11. Human answers root.
12. Root answers A.
13. A answers B.
14. `T2` returns to in progress.
15. Root sends a steering message to A while A waits for B.
16. B completes; `T2` completes.
17. A resumes with B's result and completes; `T1` completes.
18. Root receives A's result.
19. Root sends A a follow-up.
20. A answers using context from the original persistent session.
21. Pi shuts down with A idle.
22. Pi resumes the root session.
23. A is rediscovered and accepts another follow-up with preserved context.
24. No bridge process/socket was started.
25. No child accessed the todo file.
26. No timers, sockets or unhandled rejections remain after final shutdown.

This scenario is the definitive end-to-end proof of the V2 architecture.
