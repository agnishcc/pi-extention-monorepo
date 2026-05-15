import type { AssistantMessage } from "@earendil-works/pi-ai";
import { truncateToWidth } from "@earendil-works/pi-tui";
import {
	formatThinkingLabel,
	formatTokens,
	getThinkingLevel,
	renderFooterLine,
	sanitizeStatusText,
	shortenPath,
} from "./format";
import { iconCacheRead, iconCacheWrite, iconGit, iconThink, withIcon } from "./icons";
import { formatTps } from "./tps";
import type { GitStatus } from "./types";

// ── Status blacklist ──────────────────────────────────────────────────────────
// Keys in this set will not be shown in the extension statuses line (line 3).
// Common uses:
//   - "extmgr" - package manager status ("15 pkgs • auto update off")
//   - Keys for extensions whose status you want to hide
const STATUS_KEY_BLACKLIST = new Set<string>(["extmgr"]);

// ── Live state types ───────────────────────────────────────────────────────────

interface TpsState {
	isStreaming: boolean;
	tps: number;
	lastOutputTokens: number;
	lastInputTokens: number;
}

// ── Footer renderer factory ────────────────────────────────────────────────────

/**
 * Returns the footer descriptor object accepted by ctx.ui.setFooter().
 * Encapsulates all render logic for the two-line status footer.
 */
export function createFooterRenderer(
	ctx: any,
	getGitStatus: () => GitStatus | null,
	requestRender: () => void,
	hasNerdFonts: boolean,
	getTpsState: () => TpsState,
) {
	return (_tui: any, theme: any, footerData: any) => {
		const unsub = footerData.onBranchChange(() => {
			requestRender();
		});

		return {
			dispose() {
				unsub();
			},
			invalidate() {},
			render(width: number): string[] {
				const sep = theme.fg("dim", " · ");
				const groupSep = theme.fg("dim", " | ");
				const sessionName = ctx.sessionManager.getSessionName();
				const gitStatus = getGitStatus();
				const tpsState = getTpsState();

				// ── Line 1: path · branch | session name ─────────────────────
				const leftParts: string[] = [theme.fg("accent", shortenPath(ctx.cwd))];

				if (gitStatus?.branch) {
					let gitText = theme.fg(gitStatus.dirty ? "warning" : "success", gitStatus.branch);
					if (gitStatus.dirty) gitText += theme.fg("warning", " *");
					if (gitStatus.ahead) gitText += theme.fg("success", ` ↑${gitStatus.ahead}`);
					if (gitStatus.behind) gitText += theme.fg("error", ` ↓${gitStatus.behind}`);
					leftParts.push(gitText);
				} else {
					const branch = footerData.getGitBranch();
					if (branch) {
						const branchText = hasNerdFonts ? withIcon(iconGit, branch) : branch;
						leftParts.push(theme.fg("muted", branchText));
					}
				}

				const rightParts: string[] = [];
				if (sessionName) rightParts.push(theme.fg("dim", theme.italic(sessionName)));
				const locationLine = renderFooterLine(width, leftParts.join(sep), rightParts.join(sep));

				// ── Line 2: token stats · tps · model ────────────────────────

				// Aggregate token stats from all persisted entries
				let totalInput = 0;
				let totalOutput = 0;
				let totalCacheRead = 0;
				let totalCacheWrite = 0;
				let totalCost = 0;

				for (const entry of ctx.sessionManager.getEntries()) {
					if (entry.type === "message" && entry.message.role === "assistant") {
						const msg = entry.message as AssistantMessage;
						if (msg.stopReason === "error" || msg.stopReason === "aborted") continue;
						totalInput += msg.usage.input;
						totalOutput += msg.usage.output;
						totalCacheRead += msg.usage.cacheRead;
						totalCacheWrite += msg.usage.cacheWrite;
						totalCost += msg.usage.cost.total;
					}
				}

				// Build three groups separated by pipes
				// Group 1: ↑input ↓output ⚡tps
				// Group 2: Rcache Wcache $cost
				// Group 3: context%
				const { tps } = tpsState;
				const showTps = tps > 0;

				// Group 1: Read/Write + TPS
				const group1Parts: string[] = [];
				if (totalInput) group1Parts.push(`↑${formatTokens(totalInput)}`);
				if (totalOutput) group1Parts.push(`↓${formatTokens(totalOutput)}`);
				if (showTps) group1Parts.push(theme.fg("accent", `⚡${formatTps(tps)}`));
				const group1 = group1Parts.length > 0 ? group1Parts.join(" ") : null;

				// Group 2: Cache + Price
				const group2Parts: string[] = [];
				if (totalCacheRead) group2Parts.push(`${iconCacheRead}${formatTokens(totalCacheRead)}`);
				if (totalCacheWrite) group2Parts.push(`${iconCacheWrite}${formatTokens(totalCacheWrite)}`);
				const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
				if (totalCost || usingSubscription) {
					group2Parts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
				}
				const group2 = group2Parts.length > 0 ? group2Parts.join(" ") : null;

				// Group 3: Context usage
				const contextUsage = ctx.getContextUsage();
				const contextWindow = contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
				let group3: string | null = null;

				if (contextUsage && contextUsage.tokens !== null && contextWindow > 0) {
					const percent =
						contextUsage.percent !== null
							? contextUsage.percent.toFixed(1)
							: ((contextUsage.tokens / contextWindow) * 100).toFixed(1);
					const contextText = `${percent}%/${formatTokens(contextWindow)}`;
					const percentValue = contextUsage.percent ?? (contextUsage.tokens / contextWindow) * 100;
					if (percentValue > 90) group3 = theme.fg("error", contextText);
					else if (percentValue > 70) group3 = theme.fg("warning", contextText);
					else group3 = contextText;
				} else if (contextUsage && contextUsage.percent !== null) {
					const percent = contextUsage.percent.toFixed(1);
					const contextText = `${percent}%/${formatTokens(contextWindow)}`;
					if (contextUsage.percent > 90) group3 = theme.fg("error", contextText);
					else if (contextUsage.percent > 70) group3 = theme.fg("warning", contextText);
					else group3 = contextText;
				}

				// Combine groups with pipes
				const groups = [group1, group2, group3].filter((g) => g !== null) as string[];
				const leftStats = groups.join(groupSep);

				// Model + thinking level with icons
				const model = ctx.model;
				const rightPartsLine2: string[] = [];
				if (model) {
					if (model.provider && footerData.getAvailableProviderCount() > 1) {
						rightPartsLine2.push(theme.fg("muted", `(${model.provider})`));
					}
					let modelText = theme.bold(model.id || "unknown");
					if (model.reasoning) {
						const thinking = formatThinkingLabel(getThinkingLevel(ctx));
						if (thinking) {
							const thinkLabel = hasNerdFonts ? withIcon(iconThink, thinking) : thinking;
							modelText += `${sep}${theme.fg("dim", thinkLabel)}`;
						}
					}
					rightPartsLine2.push(modelText);
				}
				const statsLine = renderFooterLine(width, leftStats, rightPartsLine2.join(sep));

				// ── Line 3 (optional): extension statuses ─────────────────────
				const lines = [locationLine, statsLine];
				const extensionStatuses = footerData.getExtensionStatuses();
				// Filter out blacklisted status keys
				const visibleStatuses = new Map<string, string>(
					Array.from(extensionStatuses.entries() as [string, string][]).filter(
						([key]) => !STATUS_KEY_BLACKLIST.has(key),
					),
				);
				if (visibleStatuses.size > 0) {
					const statusLine = Array.from(visibleStatuses.values())
						.map((text) => sanitizeStatusText(text))
						.sort((a, b) => a.localeCompare(b))
						.join(" ");
					lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
				}

				return lines.map((line) => truncateToWidth(line, width));
			},
		};
	};
}
