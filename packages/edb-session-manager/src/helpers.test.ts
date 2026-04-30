import { describe, expect, it } from "vitest";
import { searchText, sessionTitle, singleLine } from "./helpers";
import type { SessionInfo } from "./types";

function session(overrides: Partial<SessionInfo>): SessionInfo {
	return {
		path: "/tmp/session.jsonl",
		id: "session-id",
		cwd: "/tmp",
		created: new Date(0),
		modified: new Date(0),
		messageCount: 1,
		firstMessage: "hello",
		allMessagesText: "hello",
		...overrides,
	} as SessionInfo;
}

describe("session manager helpers", () => {
	it("normalizes control characters to a single display line", () => {
		expect(singleLine("first\nsecond\r\nthird\tindent")).toBe("first second third indent");
	});

	it("returns session titles without embedded newlines", () => {
		const title = sessionTitle(session({ firstMessage: "first line\nsecond line" }));

		expect(title).toBe("first line second line");
		expect(title).not.toMatch(/[\r\n]/);
	});

	it("normalizes explicit session names and search text", () => {
		const s = session({ name: "named\nsession", firstMessage: "hello\nworld" });

		expect(sessionTitle(s)).toBe("named session");
		expect(searchText(s)).toBe("named session hello world");
		expect(searchText(s)).not.toMatch(/[\r\n]/);
	});
});
