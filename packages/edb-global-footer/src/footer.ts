import type { AssistantMessage } from "@mariozechner/pi-ai";
import { truncateToWidth } from "@mariozechner/pi-tui";
import {
	formatThinkingLabel,
	formatTokens,
	getThinkingLevel,
	renderFooterLine,
	sanitizeStatusText,
	shortenPath,
} from "./format";
import type { GitStatus } from "./types";

// ── Footer renderer factory ────────────────────────────────────────────────────

/**
 * Returns the footer descriptor object accepted by ctx.ui.setFooter().
 * Encapsulates all render logic for the two-line status footer.
 */
export function createFooterRenderer(ctx: any, getGitStatus: () => GitStatus | null, requestRender: () => void) {
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
				const sessionName = ctx.sessionManager.getSessionName();
				const gitStatus = getGitStatus();

				// ── Line 1: path · branch · session name ──────────────────────
				const locationParts: string[] = [theme.fg("accent", shortenPath(ctx.cwd))];

				if (gitStatus?.branch) {
					let gitText = theme.fg(gitStatus.dirty ? "warning" : "success", gitStatus.branch);
					if (gitStatus.dirty) gitText += theme.fg("warning", " *");
					if (gitStatus.ahead) gitText += theme.fg("success", ` ↑${gitStatus.ahead}`);
					if (gitStatus.behind) gitText += theme.fg("error", ` ↓${gitStatus.behind}`);
					locationParts.push(gitText);
				} else {
					const branch = footerData.getGitBranch();
					if (branch) locationParts.push(theme.fg("muted", branch));
				}

				if (sessionName) locationParts.push(theme.fg("muted", sessionName));
				const locationLine = truncateToWidth(locationParts.join(sep), width);

				// ── Line 2: token stats · model ───────────────────────────────
				let totalInput = 0;
				let totalOutput = 0;
				let totalCacheRead = 0;
				let totalCacheWrite = 0;
				let totalCost = 0;
				for (const entry of ctx.sessionManager.getEntries()) {
					if (entry.type === "message" && entry.message.role === "assistant") {
						const msg = entry.message as AssistantMessage;
						totalInput += msg.usage.input;
						totalOutput += msg.usage.output;
						totalCacheRead += msg.usage.cacheRead;
						totalCacheWrite += msg.usage.cacheWrite;
						totalCost += msg.usage.cost.total;
					}
				}

				const statsParts: string[] = [];
				if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
				if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
				if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
				if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);

				const usingSubscription = ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
				if (totalCost || usingSubscription) {
					statsParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
				}

				const contextUsage = ctx.getContextUsage();
				if (contextUsage) {
					const percentValue = contextUsage.percent ?? 0;
					const percent = contextUsage.percent !== null ? `${contextUsage.percent.toFixed(1)}%` : "?";
					const contextWindow = formatTokens(contextUsage.contextWindow);
					const contextText = `${percent}/${contextWindow}`;
					if (percentValue > 90) statsParts.push(theme.fg("error", contextText));
					else if (percentValue > 70) statsParts.push(theme.fg("warning", contextText));
					else statsParts.push(contextText);
				}
				const leftStats = statsParts.join(" ");

				const model = ctx.model;
				const rightParts: string[] = [];
				if (model) {
					if (model.provider && footerData.getAvailableProviderCount() > 1) {
						rightParts.push(theme.fg("muted", `(${model.provider})`));
					}
					let modelText = theme.bold(model.id || "unknown");
					if (model.reasoning) {
						const thinking = formatThinkingLabel(getThinkingLevel(ctx));
						if (thinking) modelText += `${sep}${theme.fg("dim", thinking)}`;
					}
					rightParts.push(modelText);
				}
				const statsLine = renderFooterLine(width, leftStats, rightParts.join(sep));

				// ── Line 3 (optional): extension statuses ─────────────────────
				const lines = [locationLine, statsLine];
				const extensionStatuses = footerData.getExtensionStatuses();
				if (extensionStatuses.size > 0) {
					const statusLine = (Array.from(extensionStatuses.entries()) as [string, string][])
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => sanitizeStatusText(text))
						.join(" ");
					lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "...")));
				}

				return lines.map((line) => truncateToWidth(line, width));
			},
		};
	};
}
