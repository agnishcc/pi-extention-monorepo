# Subagent V2 Pi SDK Validation

**SDK:** `@earendil-works/pi-coding-agent` 0.83.0
**Node.js:** 24.18.0
**Validation:** deterministic Vitest spikes using Pi's built-in faux provider

## Results

| Spike | Result | Adapter decision |
|---|---|---|
| Persistent child reopen | Pass | Persist one `SessionManager` JSONL per agent and reopen the same file for follow-ups. |
| Yielding tool and resume | Pass | A sole tool result with `terminate: true` ends the prompt segment and the same session resumes coherently. |
| Parallel-tool yield | Pass with controlled abort | Pi 0.83 continues when only one result in a parallel batch terminates. Persist `suspend_for_question`/`suspend_for_child`, call `session.abort()`, then rotate the runtime by reopening the same session file before resuming. |
| Root logical wait | Pass | A terminating root tool can later resume through `sendCustomMessage(..., { triggerTurn: true })` with correlation metadata. |
| Concurrency-one recursion | Pass | Releasing the prompt permit at each logical wait lets parent/child question and completion segments finish with one global permit. |

## Transcript observations

- `SessionManager.open()` preserves the original session ID, branch, tool results, and prior user/assistant context.
- A sole yielding tool produces a persisted assistant tool call and tool result without a second model call.
- In a mixed parallel batch, the reason-tagged abort produces an explicit aborted assistant entry. The JSONL remains valid and reopening it permits a coherent answer-resume prompt.
- Child sessions created with an empty `ResourceLoader` initialize no extensions and expose only the explicit tool allowlist.
- Structured custom-message delivery is included in the resumed model context and can carry message, run, question, and task correlation IDs.

## Hard-gate outcome

Continue with the planned architecture using runtime rotation only for controlled parallel-batch suspension. The coordinator must persist the abort reason before aborting and must never classify the resulting aborted assistant entry as run failure or completion.
