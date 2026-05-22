/**
 * edb-bridge broker process.
 *
 * Spawned as a detached child by the first connecting session.
 * Routes messages between connected sessions by broker session ID.
 * Shuts itself down 5s after the last session disconnects.
 *
 * Run: node broker.ts  (or tsx broker.ts for development)
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { createMessageReader, writeMessage } from "./framing.js";
import { BRIDGE_DIR, getBrokerPidPath, getBrokerSocketPath } from "./paths.js";
import type { BridgeMessage, ClientMessage, SessionInfo } from "./types.js";

const SOCKET_PATH = getBrokerSocketPath();
const PID_PATH = getBrokerPidPath();
const SHUTDOWN_IDLE_MS = 5_000;

interface ConnectedSession {
	socket: net.Socket;
	info: SessionInfo;
}

class EdbBridgeBroker {
	private sessions = new Map<string, ConnectedSession>();
	private server: net.Server;
	private shutdownTimer: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		mkdirSync(BRIDGE_DIR, { recursive: true });
		if (process.platform !== "win32") {
			try {
				unlinkSync(SOCKET_PATH);
			} catch {
				/* stale socket */
			}
		}
		this.server = net.createServer(this.handleConnection.bind(this));
	}

	start(): void {
		this.server.listen(SOCKET_PATH, () => {
			writeFileSync(PID_PATH, String(process.pid));
			console.log(`edb-bridge broker started (pid: ${process.pid})`);
		});
		process.on("SIGTERM", () => this.shutdown());
		process.on("SIGINT", () => this.shutdown());
	}

	private handleConnection(socket: net.Socket): void {
		let sessionId: string | null = null;

		const reader = createMessageReader(
			(msg) =>
				this.handleMessage(socket, msg as ClientMessage, sessionId, (id) => {
					sessionId = id;
				}),
			(err) => socket.destroy(err),
		);

		socket.on("data", reader);
		socket.on("close", () => {
			if (sessionId) {
				this.sessions.delete(sessionId);
				this.scheduleIdleShutdown();
			}
		});
		socket.on("error", () => {
			/* ignore */
		});
	}

	private handleMessage(
		socket: net.Socket,
		msg: ClientMessage,
		currentId: string | null,
		setId: (id: string) => void,
	): void {
		if (!msg || typeof msg !== "object" || !("type" in msg)) {
			throw new Error("invalid message");
		}

		if (currentId === null && msg.type !== "register") {
			throw new Error(`received '${msg.type}' before register`);
		}

		switch (msg.type) {
			case "register": {
				if (currentId) throw new Error("duplicate register");
				const id = randomUUID();
				setId(id);
				const info: SessionInfo = { ...msg.session, id };
				this.sessions.set(id, { socket, info });
				if (this.shutdownTimer) {
					clearTimeout(this.shutdownTimer);
					this.shutdownTimer = null;
				}
				writeMessage(socket, { type: "registered", sessionId: id });
				break;
			}

			case "unregister": {
				if (currentId) {
					this.sessions.delete(currentId);
					this.scheduleIdleShutdown();
				}
				break;
			}

			case "list": {
				if (typeof msg.requestId !== "string") throw new Error("invalid list");
				const sessions = Array.from(this.sessions.values()).map((s) => s.info);
				writeMessage(socket, { type: "sessions", requestId: msg.requestId, sessions });
				break;
			}

			case "send": {
				const message = msg.message as BridgeMessage;
				if (!message?.id || typeof msg.to !== "string") {
					writeMessage(socket, {
						type: "delivery_failed",
						messageId: message?.id ?? "",
						reason: "invalid message",
					});
					break;
				}
				const target = this.sessions.get(msg.to);
				if (!target) {
					writeMessage(socket, { type: "delivery_failed", messageId: message.id, reason: "session not found" });
					break;
				}
				const fromSession = this.sessions.get(currentId!);
				if (!fromSession) {
					writeMessage(socket, { type: "delivery_failed", messageId: message.id, reason: "sender not found" });
					break;
				}
				writeMessage(target.socket, { type: "message", from: fromSession.info, message });
				writeMessage(socket, { type: "delivered", messageId: message.id });
				break;
			}

			default:
				throw new Error(`unknown message type: ${(msg as any).type}`);
		}
	}

	private scheduleIdleShutdown(): void {
		if (this.shutdownTimer) return;
		this.shutdownTimer = setTimeout(() => {
			this.shutdownTimer = null;
			if (this.sessions.size === 0) {
				console.log("edb-bridge: no sessions, shutting down");
				this.shutdown();
			}
		}, SHUTDOWN_IDLE_MS);
	}

	private shutdown(): void {
		for (const s of this.sessions.values()) s.socket.end();
		this.sessions.clear();
		if (process.platform !== "win32") {
			try {
				unlinkSync(SOCKET_PATH);
			} catch {
				/* ignore */
			}
		}
		try {
			unlinkSync(PID_PATH);
		} catch {
			/* ignore */
		}
		this.server.close(() => process.exit(0));
	}
}

new EdbBridgeBroker().start();
