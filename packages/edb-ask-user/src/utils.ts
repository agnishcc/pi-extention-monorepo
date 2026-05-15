import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";

// ── Text wrapping ──────────────────────────────────────────────────────────────

/**
 * Reflows plain text into lines of at most `width` visible characters.
 * The last rendered line gets an ellipsis if the full text didn't fit.
 */
export function wrapText(text: string, width: number, maxLines = 4): string[] {
	const words = text.trim().split(/\s+/).filter(Boolean);
	if (!words.length) return [""];

	const lines: string[] = [];
	let current = "";

	for (const word of words) {
		const wordW = visibleWidth(word);
		const currentW = visibleWidth(current);
		if (!current) {
			current = wordW > width ? word.slice(0, width) : word;
		} else if (currentW + 1 + wordW <= width) {
			current = `${current} ${word}`;
		} else {
			lines.push(current);
			if (lines.length >= maxLines) {
				current = "";
				break;
			}
			current = wordW > width ? word.slice(0, width) : word;
		}
	}

	if (current && lines.length < maxLines) lines.push(current);

	// Append ellipsis on last line if the text was clipped
	const fullText = words.join(" ");
	const rendered = lines.join(" ");
	if (rendered.length < fullText.length && lines.length > 0) {
		const last = lines[lines.length - 1]!;
		lines[lines.length - 1] = visibleWidth(last) < width ? `${last}…` : `${last.slice(0, Math.max(0, width - 1))}…`;
	}

	return lines.length > 0 ? lines : [""];
}

// ── Modal lock ─────────────────────────────────────────────────────────────────

const MODAL_LOCK_SYMBOL = Symbol.for("edb.ask-user.modal-lock");

interface ModalLock {
	depth: number;
}

function getModalLock(): ModalLock {
	const host = globalThis as unknown as Record<PropertyKey, unknown>;
	let lock = host[MODAL_LOCK_SYMBOL] as ModalLock | undefined;
	if (!lock) {
		lock = { depth: 0 };
		host[MODAL_LOCK_SYMBOL] = lock;
	}
	return lock;
}

/** Returns true while another ask_user prompt is already open. */
export function isModalActive(): boolean {
	return getModalLock().depth > 0;
}

/** Marks a modal as open. Returns a release callback. */
export function acquireModalLock(): () => void {
	const lock = getModalLock();
	lock.depth += 1;
	let released = false;
	return () => {
		if (released) return;
		released = true;
		lock.depth = Math.max(0, lock.depth - 1);
	};
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Temp file output ───────────────────────────────────────────────────────────

/** Writes content to a unique temp file. Returns the path or an error string. */
export async function writeTempJson(content: string): Promise<{ path?: string; error?: string }> {
	try {
		const dir = await mkdtemp(join(tmpdir(), "pi-ask-user-"));
		const filePath = join(dir, "result.json");
		await writeFile(filePath, content, { encoding: "utf-8", mode: 0o600 });
		return { path: filePath };
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) };
	}
}
