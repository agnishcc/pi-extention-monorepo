import { buildSessionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ThinkingLevel } from "./types";

// ── Format helpers ─────────────────────────────────────────────────────────────

export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

export function shortenPath(cwd: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && cwd.startsWith(home)) return `~${cwd.slice(home.length)}`;
	return cwd;
}

export function getThinkingLevel(ctx: {
	sessionManager: {
		getEntries(): unknown[];
		getLeafId(): string | null;
	};
}): ThinkingLevel {
	const context = buildSessionContext(ctx.sessionManager.getEntries() as any, ctx.sessionManager.getLeafId());
	return (context.thinkingLevel || "off") as ThinkingLevel;
}

export function formatThinkingLabel(level: ThinkingLevel): string {
	switch (level) {
		case "minimal":
			return "MI";
		case "low":
			return "L";
		case "medium":
			return "M";
		case "high":
			return "H";
		case "xhigh":
			return "XH";
		default:
			return "";
	}
}

export function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

export function renderFooterLine(width: number, left: string, right: string): string {
	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(right);
	const minGap = 2;

	if (leftWidth + minGap + rightWidth <= width) {
		return left + " ".repeat(width - leftWidth - rightWidth) + right;
	}

	if (leftWidth + minGap + 10 <= width) {
		const available = width - leftWidth - minGap;
		const truncated = truncateToWidth(right, available, "");
		return left + " ".repeat(Math.max(1, width - leftWidth - visibleWidth(truncated))) + truncated;
	}

	return truncateToWidth(left, width, "");
}
