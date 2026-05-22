import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import net from "node:net";
import { createMessageReader, writeMessage } from "./framing.js";
import { getBrokerSocketPath } from "./paths.js";
import type { BridgeMessage, BrokerMessage, SessionInfo } from "./types.js";

const SOCKET_PATH = getBrokerSocketPath();

export interface SendOptions {
	text: string;
	data?: Record<string, unknown>;
	type?: string;
	replyTo?: string;
	expectsReply?: boolean;
	messageId?: string;
}

export interface SendResult {
	id: string;
	delivered: boolean;
	reason?: string;
}

interface PendingSend {
	resolve: (r: SendResult) => void;
	reject: (e: Error) => void;
}

interface PendingList {
	resolve: (sessions: SessionInfo[]) => void;
	reject: (e: Error) => void;
}

function toError(e: unknown): Error {
	return e instanceof Error ? e : new Error(String(e));
}

function isSessionInfo(v: unknown): v is SessionInfo {
	if (!v || typeof v !== "object") return false;
	const s = v as Record<string, unknown>;
	return typeof s.id === "string" && typeof s.cwd === "string";
}

function isBridgeMessage(v: unknown): v is BridgeMessage {
	if (!v || typeof v !== "object") return false;
	const m = v as Record<string, unknown>;
	return (
		typeof m.id === "string" &&
		typeof m.timestamp === "number" &&
		m.content !== null &&
		typeof m.content === "object" &&
		typeof (m.content as any).text === "string"
	);
}

export class BridgeClient extends EventEmitter {
	private socket: net.Socket | null = null;
	private _sessionId: string | null = null;
	private pendingSends = new Map<string, PendingSend>();
	private pendingLists = new Map<string, PendingList>();
	private disconnecting = false;
	private disconnectError: Error | null = null;

	get sessionId(): string | null {
		return this._sessionId;
	}

	isConnected(): boolean {
		const s = this.socket;
		return Boolean(s && this._sessionId && !this.disconnecting && !s.destroyed && !s.writableEnded && s.writable);
	}

	private requireSocket(): net.Socket {
		if (this.disconnecting) throw new Error("disconnecting");
		const s = this.socket;
		if (!s || !this._sessionId) throw new Error("not connected");
		if (s.destroyed || s.writableEnded || !s.writable) throw new Error("disconnected");
		return s;
	}

	private failPending(err: Error): void {
		for (const p of this.pendingSends.values()) p.reject(err);
		this.pendingSends.clear();
		for (const p of this.pendingLists.values()) p.reject(err);
		this.pendingLists.clear();
	}

	connect(session: Omit<SessionInfo, "id">): Promise<void> {
		if (this.socket) return Promise.reject(new Error("already connected"));

		return new Promise((resolve, reject) => {
			const socket = net.connect(SOCKET_PATH);
			this.socket = socket;
			this.disconnectError = null;
			let settled = false;
			let connected = false;

			const timeout = setTimeout(() => {
				if (!this._sessionId) {
					cleanupAttempt();
					cleanupSocket();
					if (this.socket === socket) this.socket = null;
					socket.destroy();
					reject(new Error("edb-bridge: connection timeout"));
				}
			}, 10_000);

			const onRegistered = () => {
				settled = true;
				connected = true;
				cleanupAttempt();
				resolve();
			};

			const onError = (err: Error) => {
				settled = true;
				cleanupAttempt();
				cleanupSocket();
				if (this.socket === socket) this.socket = null;
				socket.destroy();
				reject(err);
			};

			const onClose = () => {
				const wasConnecting = !settled && !this._sessionId;
				const wasDisconnecting = this.disconnecting;
				const err = this.disconnectError ?? new Error("edb-bridge: disconnected");
				this.disconnecting = false;
				cleanupAttempt();
				cleanupSocket();
				this.failPending(err);
				if (this.socket === socket) this.socket = null;
				this._sessionId = null;
				this.disconnectError = null;
				if (connected && !wasDisconnecting) this.emit("disconnected", err);
				if (wasConnecting) reject(new Error("edb-bridge: connection closed before registration"));
			};

			const onSocketError = (err: Error) => {
				if (connected) {
					this.disconnectError = err;
					this.emit("error", err);
				}
			};

			const onReaderError = (err: Error) => {
				if (!connected) {
					onError(err);
					return;
				}
				this.disconnectError = err;
				this.emit("error", err);
				socket.destroy();
			};

			const reader = createMessageReader((msg) => this.handleBrokerMessage(msg as BrokerMessage), onReaderError);

			const cleanupAttempt = () => {
				this.off("_registered", onRegistered);
				socket.off("error", onError);
				clearTimeout(timeout);
			};

			const cleanupSocket = () => {
				socket.off("data", reader);
				socket.off("error", onSocketError);
				socket.off("close", onClose);
			};

			socket.on("data", reader);
			socket.on("error", onError);
			socket.on("close", onClose);
			socket.on("error", onSocketError);
			this.once("_registered", onRegistered);

			try {
				writeMessage(socket, { type: "register", session });
			} catch (err) {
				cleanupAttempt();
				cleanupSocket();
				if (this.socket === socket) this.socket = null;
				socket.destroy();
				reject(toError(err));
			}
		});
	}

	private handleBrokerMessage(msg: BrokerMessage): void {
		if (!msg || typeof msg !== "object" || !("type" in msg)) {
			throw new Error("invalid broker message");
		}

		switch (msg.type) {
			case "registered": {
				if (this._sessionId !== null) throw new Error("duplicate registered");
				this._sessionId = msg.sessionId;
				this.emit("_registered");
				break;
			}

			case "sessions": {
				const p = this.pendingLists.get(msg.requestId);
				if (!p) return;
				this.pendingLists.delete(msg.requestId);
				p.resolve(msg.sessions as SessionInfo[]);
				break;
			}

			case "message": {
				if (!isSessionInfo(msg.from) || !isBridgeMessage(msg.message)) {
					throw new Error("invalid message event");
				}
				this.emit("message", msg.from, msg.message);
				break;
			}

			case "delivered": {
				const p = this.pendingSends.get(msg.messageId);
				if (!p) return;
				this.pendingSends.delete(msg.messageId);
				p.resolve({ id: msg.messageId, delivered: true });
				break;
			}

			case "delivery_failed": {
				const p = this.pendingSends.get(msg.messageId);
				if (!p) return;
				this.pendingSends.delete(msg.messageId);
				p.resolve({ id: msg.messageId, delivered: false, reason: msg.reason });
				break;
			}

			case "session_joined":
			case "session_left":
				// broadcast events — not used currently
				break;

			default:
				throw new Error(`unknown broker message type: ${(msg as any).type}`);
		}
	}

	async disconnect(): Promise<void> {
		const socket = this.socket;
		if (!socket) return;

		this.disconnecting = true;
		this.disconnectError = null;
		this.failPending(new Error("edb-bridge: disconnected"));

		await new Promise<void>((resolve) => {
			let done = false;
			const finish = () => {
				if (done) return;
				done = true;
				clearTimeout(t);
				socket.off("close", onClose);
				socket.off("error", onError);
				resolve();
			};
			const onClose = () => finish();
			const onError = () => {
				socket.destroy();
			};
			const t = setTimeout(() => {
				socket.destroy();
			}, 2000);
			socket.once("close", onClose);
			socket.once("error", onError);
			try {
				writeMessage(socket, { type: "unregister" });
				socket.end();
			} catch {
				socket.destroy();
			}
		});
	}

	listSessions(): Promise<SessionInfo[]> {
		let socket: net.Socket;
		try {
			socket = this.requireSocket();
		} catch (e) {
			return Promise.reject(toError(e));
		}

		return new Promise((resolve, reject) => {
			const requestId = randomUUID();
			let done = false;
			const timeout = setTimeout(() => {
				if (!done) {
					done = true;
					this.pendingLists.delete(requestId);
					reject(new Error("edb-bridge: list sessions timeout"));
				}
			}, 5000);
			this.pendingLists.set(requestId, {
				resolve: (sessions) => {
					clearTimeout(timeout);
					done = true;
					resolve(sessions);
				},
				reject: (err) => {
					clearTimeout(timeout);
					done = true;
					reject(err);
				},
			});
			try {
				writeMessage(socket, { type: "list", requestId });
			} catch (err) {
				clearTimeout(timeout);
				this.pendingLists.delete(requestId);
				reject(toError(err));
			}
		});
	}

	send(to: string, options: SendOptions): Promise<SendResult> {
		let socket: net.Socket;
		try {
			socket = this.requireSocket();
		} catch (e) {
			return Promise.reject(toError(e));
		}

		const messageId = options.messageId ?? randomUUID();
		const message: BridgeMessage = {
			id: messageId,
			timestamp: Date.now(),
			replyTo: options.replyTo,
			expectsReply: options.expectsReply,
			type: options.type,
			content: { text: options.text, data: options.data },
		};

		return new Promise((resolve, reject) => {
			let done = false;
			const timeout = setTimeout(() => {
				if (!done) {
					done = true;
					this.pendingSends.delete(messageId);
					reject(new Error("edb-bridge: send timeout"));
				}
			}, 10_000);
			this.pendingSends.set(messageId, {
				resolve: (r) => {
					clearTimeout(timeout);
					done = true;
					resolve(r);
				},
				reject: (err) => {
					clearTimeout(timeout);
					done = true;
					reject(err);
				},
			});
			try {
				writeMessage(socket, { type: "send", to, message });
			} catch (err) {
				clearTimeout(timeout);
				this.pendingSends.delete(messageId);
				reject(toError(err));
			}
		});
	}
}
