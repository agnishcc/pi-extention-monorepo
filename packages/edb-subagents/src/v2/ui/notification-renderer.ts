import { Text } from "@earendil-works/pi-tui";

/** Structured details attached to V2 sub-agent completion notifications (root_message outbox ops). */
export interface V2NotificationDetails {
	messageId: string;
	agentId: string;
	agentName?: string;
	description?: string;
	state: string;
	taskId?: string | null;
	startedAt?: string | null;
	completedAt?: string | null;
	error?: string;
	resultPreview?: string;
	transcript?: string;
}

function formatMs(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * TUI renderer for "edb-subagents-v2" custom messages — mirrors the V1
 * "subagent-notification" renderer (icon + name + status, stats line, result
 * preview, transcript path) against the V2 notification details shape.
 */
export function renderV2Notification(d: V2NotificationDetails, expanded: boolean, theme: any): Text {
	const isError = d.state !== "completed";
	const icon = isError ? theme.fg("error", "✗") : theme.fg("success", "✓");
	const statusText = isError ? d.state : "completed";
	const name = d.description ?? d.agentName ?? d.agentId;

	let line = `${icon} ${theme.bold(name)} ${theme.fg("dim", statusText)}`;

	const parts: string[] = [];
	if (d.taskId) parts.push(`task ${d.taskId}`);
	if (d.startedAt && d.completedAt) parts.push(formatMs(Date.parse(d.completedAt) - Date.parse(d.startedAt)));
	if (d.agentId) parts.push(d.agentId.slice(-6));
	if (parts.length > 0) {
		line += `\n  ${parts.map((p) => theme.fg("dim", p)).join(` ${theme.fg("dim", "·")} `)}`;
	}

	if (d.error) line += `\n  ${theme.fg("error", d.error.slice(0, 120))}`;

	if (d.resultPreview) {
		if (expanded) {
			for (const l of d.resultPreview.split("\n").slice(0, 30)) line += `\n${theme.fg("dim", `  ${l}`)}`;
		} else {
			const preview = d.resultPreview.split("\n")[0]?.slice(0, 80) ?? "";
			line += `\n  ${theme.fg("dim", `⎿  ${preview}`)}`;
		}
	}

	if (d.transcript) line += `\n  ${theme.fg("muted", `transcript: ${d.transcript}`)}`;

	return new Text(line, 0, 0);
}
