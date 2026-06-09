/**
 * edb-bridge — lightweight inter-session message bus for orchestrator/sub-agent workflows.
 *
 * Since edb-subagents creates in-process sessions (not separate processes), per-session
 * bridge context is injected via the system prompt as XML tags rather than env vars.
 *
 * System prompt tags (injected by edb-subagents into sub-agent prompts):
 *   <bridge_parent_session>{broker session ID of parent}</bridge_parent_session>
 *   <bridge_agent_id>{edb-subagents agent ID}</bridge_agent_id>
 *
 * Internal pi.events API:
 *   "bridge:ready"        → { sessionId: string }   emitted on broker connect
 *   "bridge:task_updated" → { storePath?: string }  from edb-todo; routed to parent session
 *
 * LLM tools:
 *   ask_supervisor    — blocking question to orchestrator (sub-agent only, when bridge context found)
 *   notify_parent     — fire-and-forget progress update (sub-agent only, updates task widget spinner)
 *   send_to_main      — fire-and-forget message that triggers an orchestrator LLM turn (sub-agent only)
 *   answer_subagent   — reply to a pending sub-agent question (all sessions)
 */

import { randomUUID } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { BridgeClient } from "./client.js";
import { spawnBrokerIfNeeded } from "./spawn.js";
import type { BridgeMessage, SessionInfo } from "./types.js";

// ── Event names ────────────────────────────────────────────────────────────────

const EV_READY = "bridge:ready";
const EV_TASK_UPDATED = "bridge:task_updated";

const ASK_TIMEOUT_MS = 10 * 60 * 1000;

function getError(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function textResult(text: string) {
	return { content: [{ type: "text" as const, text }], details: undefined };
}

// ── Per-session bridge context ─────────────────────────────────────────────────

interface BridgeSessionContext {
	parentSessionId: string;
	agentId?: string;
	/** Assigned task ID from <assigned_task_id> system prompt tag. */
	taskId?: string;
}

// Parsed from system prompt — keyed by session ID
const sessionBridgeCtx = new Map<string, BridgeSessionContext>();

function parseBridgeContext(systemPrompt: string): BridgeSessionContext | null {
	const parentMatch = systemPrompt.match(/<bridge_parent_session>(.*?)<\/bridge_parent_session>/s);
	if (!parentMatch) return null;
	const agentMatch = systemPrompt.match(/<bridge_agent_id>(.*?)<\/bridge_agent_id>/s);
	const taskMatch = systemPrompt.match(/<assigned_task_id>(.*?)<\/assigned_task_id>/s);
	return {
		parentSessionId: parentMatch[1]!.trim(),
		agentId: agentMatch?.[1]?.trim(),
		taskId: taskMatch?.[1]?.trim(),
	};
}

// ── Pending ask registry ───────────────────────────────────────────────────────

interface PendingAsk {
	messageId: string;
	fromSessionId: string;
	agentId?: string;
	/** Linked task ID — used to auto-unblock the task when answered. */
	taskId?: string;
	question: string;
	resolve: (answer: string) => void;
	reject: (err: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export default function edbBridgeExtension(pi: ExtensionAPI): void {
	let client: BridgeClient | null = null;
	let currentSessionId: string | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let reconnectAttempt = 0;
	let shuttingDown = false;
	let mainSessionId: string | null = null; // broker session ID of THIS session
	/** The pi session ID of the orchestrator (main/first session_start). */
	let mainPiSessionId: string | null = null;

	const pendingAsks = new Map<string, PendingAsk>();

	function handleIncoming(from: SessionInfo, message: BridgeMessage): void {
		// Task update notification — trigger widget refresh
		if (message.type === "task_updated") {
			pi.events.emit(EV_TASK_UPDATED, message.content.data ?? {});
			return;
		}

		// Incoming ask from sub-agent
		if (message.type === "ask_supervisor" && message.expectsReply) {
			const agentId = message.content.data?.agentId as string | undefined;
			const taskId = message.content.data?.taskId as string | undefined;

			const timer = setTimeout(() => {
				const ask = pendingAsks.get(message.id);
				if (ask) {
					pendingAsks.delete(message.id);
					ask.reject(new Error("Ask timed out — no answer within 10 minutes"));
				}
			}, ASK_TIMEOUT_MS);

			let resolveFn!: (answer: string) => void;
			let rejectFn!: (err: Error) => void;
			new Promise<string>((res, rej) => {
				resolveFn = res;
				rejectFn = rej;
			});

			pendingAsks.set(message.id, {
				messageId: message.id,
				fromSessionId: from.id,
				agentId,
				taskId,
				question: message.content.text,
				resolve: resolveFn,
				reject: rejectFn,
				timer,
			});

			// Auto-block the linked task in the widget
			if (taskId) {
				pi.events.emit("bridge:ask_supervisor", {
					taskId,
					question: message.content.text,
					messageId: message.id,
				});
			}

			const agentLabel = agentId ? `sub-agent ${agentId}` : `sub-agent (session ${from.id.slice(0, 8)})`;
			const taskNote = taskId ? `\nLinked task: #${taskId}` : "";

			pi.sendMessage(
				{
					customType: "bridge-ask",
					content:
						`**Question from ${agentLabel}:**\n\n${message.content.text}${taskNote}\n\n` +
						`To answer: \`answer_subagent({ message_id: "${message.id}", answer: "..." })\``,
					display: true,
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
			return;
		}

		// Progress update from sub-agent
		if (message.type === "notify_parent") {
			const agentId = message.content.data?.agentId as string | undefined;
			const taskId = message.content.data?.taskId as string | undefined;
			const label = agentId ? agentId : `sub-agent (session ${from.id.slice(0, 8)})`;
			// If task_id provided, fire an event so edb-todo can update activeForm in the widget
			if (taskId) {
				pi.events.emit("bridge:notify_parent", { taskId, message: message.content.text, agentId });
			}
			pi.sendMessage(
				{
					customType: "bridge-notify",
					content: `**Update from ${label}:** ${message.content.text}`,
					display: true,
				},
				{ deliverAs: "followUp" },
			);
		}

		// Direct message from sub-agent — triggers an orchestrator LLM turn
		if (message.type === "send_to_main") {
			const agentId = message.content.data?.agentId as string | undefined;
			const taskId = message.content.data?.taskId as string | undefined;
			const label = agentId ? agentId : `sub-agent (session ${from.id.slice(0, 8)})`;
			const taskNote = taskId ? ` (task #${taskId})` : "";
			pi.sendMessage(
				{
					customType: "bridge-send-to-main",
					content: `**Message from ${label}${taskNote}:** ${message.content.text}`,
					display: true,
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
		}
	}

	async function ensureConnected(): Promise<BridgeClient> {
		if (shuttingDown) throw new Error("bridge shutting down");
		if (client?.isConnected()) return client;

		await spawnBrokerIfNeeded();

		const nextClient = new BridgeClient();
		nextClient.on("message", (from: SessionInfo, message: BridgeMessage) => {
			if (client === nextClient) handleIncoming(from, message);
		});
		nextClient.on("disconnected", () => {
			if (client !== nextClient) return;
			client = null;
			if (!shuttingDown) scheduleReconnect();
		});
		nextClient.on("error", () => {
			/* handled by disconnect */
		});

		await nextClient.connect({
			cwd: process.cwd(),
			pid: process.pid,
			startedAt: Date.now(),
		});

		client = nextClient;
		reconnectAttempt = 0;
		mainSessionId = client.sessionId;
		pi.events.emit(EV_READY, { sessionId: mainSessionId });

		return nextClient;
	}

	function scheduleReconnect(): void {
		if (reconnectTimer || shuttingDown) return;
		const delays = [1000, 2000, 5000, 10000, 30000];
		const delay = delays[Math.min(reconnectAttempt, delays.length - 1)]!;
		reconnectTimer = setTimeout(async () => {
			reconnectTimer = null;
			reconnectAttempt++;
			try {
				await ensureConnected();
			} catch {
				scheduleReconnect();
			}
		}, delay);
	}

	// edb-todo emits bridge:task_updated when tasks change — route to parent
	pi.events.on(EV_TASK_UPDATED, async (payload: unknown) => {
		// Only route if this event came from a sub-agent session (has bridge context)
		const p = payload as { storePath?: string; sessionId?: string } | undefined;
		const sessionId = p?.sessionId;
		if (!sessionId) return;
		const ctx = sessionBridgeCtx.get(sessionId);
		if (!ctx) return;

		try {
			const c = await ensureConnected();
			await c.send(ctx.parentSessionId, {
				type: "task_updated",
				text: "task store updated",
				data: (payload as Record<string, unknown>) ?? {},
			});
		} catch {
			/* best-effort */
		}
	});

	// ── Session lifecycle ──────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		currentSessionId = ctx.sessionManager.getSessionId();
		// Track the first (orchestrator) session — sub-agent sessions must not shut down the client
		if (!mainPiSessionId) mainPiSessionId = currentSessionId;
		shuttingDown = false;
		// Only connect for the main (orchestrator) session.
		// Sub-agent sessions run in-process and share the same client — reconnecting would
		// replace the orchestrator's broker session ID, breaking cross-session routing.
		if (currentSessionId === mainPiSessionId) {
			try {
				await ensureConnected();
			} catch {
				scheduleReconnect();
			}
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		currentSessionId = sessionId;
		// Parse bridge context from system prompt (first time only)
		if (!sessionBridgeCtx.has(sessionId)) {
			const bridgeCtx = parseBridgeContext(event.systemPrompt);
			if (bridgeCtx) {
				sessionBridgeCtx.set(sessionId, bridgeCtx);
			}
		}
	});

	pi.on("session_shutdown", async () => {
		const isMainSession = currentSessionId === mainPiSessionId;

		// Clean up per-session state regardless
		if (currentSessionId) sessionBridgeCtx.delete(currentSessionId);

		if (isMainSession) {
			// Full teardown — this is the orchestrator shutting down
			shuttingDown = true;
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			for (const ask of pendingAsks.values()) {
				clearTimeout(ask.timer);
				ask.reject(new Error("Session shutting down"));
			}
			pendingAsks.clear();
			if (client) {
				await client.disconnect();
				client = null;
			}
			currentSessionId = null;
			mainSessionId = null;
			mainPiSessionId = null;
		}
		// Sub-agent session shutdown: do NOT disconnect the shared client
		// The orchestrator's connection must remain active
		// Restore currentSessionId to the main session after sub-agent exits
		if (!isMainSession) {
			currentSessionId = mainPiSessionId;
		}
	});

	// ── Tools ──────────────────────────────────────────────────────────────────

	// ── answer_subagent (all sessions) ────────────────────────────────────────

	pi.registerTool({
		name: "answer_subagent",
		label: "Answer Sub-agent",
		description:
			"Reply to a pending question from a sub-agent. The sub-agent is blocking and waiting for your answer.\n\n" +
			"Use the message_id shown in the question notification.",
		parameters: Type.Object({
			message_id: Type.String({ description: "The message ID from the sub-agent's question." }),
			answer: Type.String({ description: "Your answer. The sub-agent will resume with this." }),
		}),

		async execute(_id, params) {
			const ask = pendingAsks.get(params.message_id);
			if (!ask) {
				return textResult(
					`No pending question with id "${params.message_id}". It may have timed out or already been answered.`,
				);
			}

			try {
				const c = await ensureConnected();
				const result = await c.send(ask.fromSessionId, {
					type: "supervisor_reply",
					text: params.answer,
					replyTo: ask.messageId,
				});

				clearTimeout(ask.timer);
				pendingAsks.delete(ask.messageId);
				ask.resolve(params.answer);

				// Auto-unblock the linked task
				if (ask.taskId) {
					pi.events.emit("bridge:supervisor_answered", { taskId: ask.taskId });
				}

				// Resume the suspended sub-agent session with the answer.
				// edb-subagents listens for this event and calls manager.resumeInBackground.
				if (ask.agentId) {
					pi.events.emit("bridge:resume_agent", { agentId: ask.agentId, answer: params.answer });
				}

				if (!result.delivered) {
					return textResult(
						`Answer could not reach sub-agent (${result.reason ?? "disconnected"}). The ask was resolved locally.`,
					);
				}
				return textResult(`Answer delivered to ${ask.agentId ? `sub-agent ${ask.agentId}` : "sub-agent"}.`);
			} catch (err) {
				return textResult(`Failed to deliver answer: ${getError(err)}`);
			}
		},

		renderCall(args, theme) {
			const preview = ((args.answer as string) ?? "").slice(0, 80);
			return new Text(
				`${theme.fg("toolTitle", theme.bold("answer_subagent "))}${theme.fg("muted", `→ ${preview}`)}`,
				0,
				0,
			);
		},
	});

	// ── ask_supervisor (sub-agent sessions with bridge context) ———————————

	pi.registerTool({
		name: "ask_supervisor",
		label: "Ask Supervisor",
		description:
			"Ask the orchestrator a question. Returns immediately — your session will be automatically resumed with the answer.\n\n" +
			"Use when blocked, uncertain, or facing a decision that requires supervisor input.\n" +
			"Do NOT use for routine completion — return results normally.",
		promptSnippet:
			"Ask the orchestrator a question. Returns immediately — session resumes automatically with the answer.",
		promptGuidelines: [
			"Use ask_supervisor when blocked by a decision or missing critical information.",
			"Do not use for routine task completion.",
			"After calling ask_supervisor, write a brief status of your progress then stop all tool calls. Your session resumes automatically when the supervisor answers.",
		],
		parameters: Type.Object({
			question: Type.String({ description: "The question for the supervisor." }),
			task_id: Type.Optional(Type.String({ description: "Optional: linked task ID." })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const sessionId = ctx.sessionManager.getSessionId();
			const bridgeCtx = sessionBridgeCtx.get(sessionId);

			if (!bridgeCtx) {
				return textResult(
					"ask_supervisor: not in a sub-agent session with bridge support. Is PI_BRIDGE context injected into the system prompt?",
				);
			}

			const c = await ensureConnected().catch((e) => {
				throw new Error(`Bridge not connected: ${getError(e)}`);
			});

			const messageId = randomUUID();

			// Signal edb-subagents to mark this agent as suspending BEFORE we send
			// the message — ensures the flag is set before runAgent() can return.
			if (bridgeCtx.agentId) {
				pi.events.emit("bridge:agent_suspending", { agentId: bridgeCtx.agentId });
			}

			try {
				const result = await c.send(bridgeCtx.parentSessionId, {
					type: "ask_supervisor",
					text: params.question,
					messageId,
					expectsReply: true,
					data: { agentId: bridgeCtx.agentId, taskId: params.task_id ?? bridgeCtx.taskId },
				});

				if (!result.delivered) {
					if (bridgeCtx.agentId) {
						pi.events.emit("bridge:agent_suspend_cancelled", { agentId: bridgeCtx.agentId });
					}
					return textResult(
						`Supervisor not reachable: ${result.reason ?? "session not found"}. Continuing without answer.`,
					);
				}
			} catch (err) {
				if (bridgeCtx.agentId) {
					pi.events.emit("bridge:agent_suspend_cancelled", { agentId: bridgeCtx.agentId });
				}
				return textResult(`Failed to send question: ${getError(err)}. Continuing without answer.`);
			}

			// Fire-and-forget: return immediately. The supervisor answers via
			// answer_subagent, which emits bridge:resume_agent to restart this session.
			return textResult(
				"Question sent to supervisor. " +
					"Write a brief summary of your progress so far, then stop all tool calls. " +
					"Your session will be resumed automatically with the supervisor's answer.",
			);
		},

		renderCall(args, theme) {
			const q = ((args.question as string) ?? "").slice(0, 80);
			return new Text(
				`${theme.fg("toolTitle", theme.bold("ask_supervisor "))}${theme.fg("warning", "⏸")} ${theme.fg("muted", q)}`,
				0,
				0,
			);
		},

		renderResult(result, _opts, theme) {
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";
			return new Text(theme.fg("warning", "⏸ ") + theme.fg("muted", text.slice(0, 120)), 0, 0);
		},
	});

	// ── notify_parent (sub-agent sessions with bridge context) ────────────────

	pi.registerTool({
		name: "notify_parent",
		label: "Notify Parent",
		description:
			"Send a fire-and-forget progress update to the orchestrator.\n\n" +
			"Use for meaningful milestones or plan-changing discoveries. Does not block.\n" +
			"When your task_id is known (injected at spawn), it's automatically used to update the widget spinner.",
		promptSnippet: "Send a non-blocking progress update to the orchestrator.",
		promptGuidelines: [
			"Use notify_parent only for meaningful progress or plan-changing discoveries.",
			"Do not use for routine task completion.",
		],
		parameters: Type.Object({
			message: Type.String({ description: "Progress update for the supervisor." }),
			task_id: Type.Optional(Type.String({ description: "Optional: linked task ID." })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const sessionId = ctx.sessionManager.getSessionId();
			const bridgeCtx = sessionBridgeCtx.get(sessionId);

			if (!bridgeCtx) {
				return textResult("notify_parent: not in a sub-agent session with bridge support.");
			}

			try {
				const c = await ensureConnected();
				const result = await c.send(bridgeCtx.parentSessionId, {
					type: "notify_parent",
					text: params.message,
					data: { agentId: bridgeCtx.agentId, taskId: params.task_id ?? bridgeCtx.taskId },
				});
				if (!result.delivered) {
					return textResult(
						`Update could not be delivered (${result.reason ?? "supervisor not reachable"}). Continuing.`,
					);
				}
				return textResult("Update sent to supervisor.");
			} catch (err) {
				return textResult(`Failed to send update: ${getError(err)}. Continuing.`);
			}
		},

		renderCall(args, theme) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("notify_parent "))}${theme.fg("muted", ((args.message as string) ?? "").slice(0, 80))}`,
				0,
				0,
			);
		},
	});

	// ── send_to_main (sub-agent sessions with bridge context) ────────────────────────────────────

	pi.registerTool({
		name: "send_to_main",
		label: "Send to Main",
		description:
			"Send a message to the orchestrator that triggers an immediate LLM response turn.\n\n" +
			"Unlike notify_parent (which only updates the task widget spinner), this delivers a message " +
			"into the orchestrator's conversation and wakes it up to respond. " +
			"Use for important findings that require orchestrator action or decision, " +
			"or to report a result that the orchestrator should act on without waiting for you to complete fully.",
		promptSnippet: "Send a message to the orchestrator that triggers an immediate response turn.",
		promptGuidelines: [
			"Use send_to_main for important findings or decisions that require orchestrator action now.",
			"For routine progress updates that only update the spinner, use notify_parent instead.",
			"Does not block — the orchestrator will process the message asynchronously.",
		],
		parameters: Type.Object({
			message: Type.String({ description: "The message to send to the orchestrator." }),
			task_id: Type.Optional(Type.String({ description: "Optional: linked task ID shown in the message header." })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const sessionId = ctx.sessionManager.getSessionId();
			const bridgeCtx = sessionBridgeCtx.get(sessionId);

			if (!bridgeCtx) {
				return textResult("send_to_main: not in a sub-agent session with bridge support.");
			}

			try {
				const c = await ensureConnected();
				const result = await c.send(bridgeCtx.parentSessionId, {
					type: "send_to_main",
					text: params.message,
					data: { agentId: bridgeCtx.agentId, taskId: params.task_id ?? bridgeCtx.taskId },
				});
				if (!result.delivered) {
					return textResult(
						`Message could not be delivered (${result.reason ?? "orchestrator not reachable"}). Continuing.`,
					);
				}
				return textResult("Message sent to orchestrator.");
			} catch (err) {
				return textResult(`Failed to send message: ${getError(err)}. Continuing.`);
			}
		},

		renderCall(args, theme) {
			return new Text(
				`${theme.fg("toolTitle", theme.bold("send_to_main "))}${theme.fg("accent", ((args.message as string) ?? "").slice(0, 80))}`,
				0,
				0,
			);
		},
	});
}
