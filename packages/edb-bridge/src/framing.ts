import type { Socket } from "node:net";

/**
 * Write a length-prefixed JSON message to a socket.
 * Format: 4-byte big-endian uint32 length + UTF-8 JSON payload.
 */
export function writeMessage(socket: Socket, msg: unknown): void {
	const json = JSON.stringify(msg);
	const payload = Buffer.from(json, "utf-8");
	const header = Buffer.alloc(4);
	header.writeUInt32BE(payload.length, 0);
	socket.write(Buffer.concat([header, payload]));
}

/**
 * Create a streaming message reader that handles partial TCP reads.
 * Calls onMessage for each complete framed message.
 * Protocol errors are reported to onError — caller should close the socket.
 */
export function createMessageReader(onMessage: (msg: unknown) => void, onError: (error: Error) => void) {
	let buffer = Buffer.alloc(0);

	return (data: Buffer) => {
		buffer = Buffer.concat([buffer, data]);

		while (buffer.length >= 4) {
			const length = buffer.readUInt32BE(0);
			if (buffer.length < 4 + length) break;

			const payload = buffer.subarray(4, 4 + length);
			buffer = buffer.subarray(4 + length);

			let msg: unknown;
			try {
				msg = JSON.parse(payload.toString("utf-8"));
			} catch (err) {
				onError(new Error(`edb-bridge: failed to parse message: ${err}`, { cause: err }));
				return;
			}

			try {
				onMessage(msg);
			} catch (err) {
				onError(new Error(`edb-bridge: failed to handle message: ${err}`, { cause: err }));
				return;
			}
		}
	};
}
