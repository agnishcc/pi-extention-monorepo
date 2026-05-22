// ── Shared types for edb-bridge ───────────────────────────────────────────────

export interface SessionInfo {
	id: string; // broker-assigned session ID
	cwd: string;
	pid: number;
	parentId?: string; // parent broker session ID (set by sub-agents)
	agentId?: string; // edb-subagents agent ID (set by sub-agents)
	startedAt: number;
}

export interface BridgeMessage {
	id: string;
	timestamp: number;
	replyTo?: string; // message ID this is a reply to
	expectsReply?: boolean;
	type?: string; // optional message type tag (e.g. "task_updated", "ask_supervisor")
	content: {
		text: string;
		data?: Record<string, unknown>; // structured payload
	};
}

// ── Client → Broker ───────────────────────────────────────────────────────────

export type ClientMessage =
	| { type: "register"; session: Omit<SessionInfo, "id"> }
	| { type: "unregister" }
	| { type: "send"; to: string; message: BridgeMessage }
	| { type: "list"; requestId: string };

// ── Broker → Client ───────────────────────────────────────────────────────────

export type BrokerMessage =
	| { type: "registered"; sessionId: string }
	| { type: "sessions"; requestId: string; sessions: SessionInfo[] }
	| { type: "message"; from: SessionInfo; message: BridgeMessage }
	| { type: "delivered"; messageId: string }
	| { type: "delivery_failed"; messageId: string; reason: string }
	| { type: "session_joined"; session: SessionInfo }
	| { type: "session_left"; sessionId: string };
