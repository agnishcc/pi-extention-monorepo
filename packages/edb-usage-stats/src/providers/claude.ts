import { execSync } from "node:child_process";
import type { UsageSnapshot } from "./common";
import { formatReset, readPiAuth } from "./common";

function loadClaudeToken(): string | undefined {
	const auth = readPiAuth();
	if (auth?.anthropic?.access) return auth.anthropic.access;

	// Fallback to Claude CLI keychain (macOS)
	try {
		const keychainData = execSync('security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null', {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
		if (keychainData) {
			const parsed = JSON.parse(keychainData);
			const scopes = parsed.claudeAiOauth?.scopes || [];
			if (scopes.includes("user:profile") && parsed.claudeAiOauth?.accessToken) {
				return parsed.claudeAiOauth.accessToken;
			}
		}
	} catch {}

	return undefined;
}

export async function fetchClaudeUsage(): Promise<UsageSnapshot> {
	const token = loadClaudeToken();
	if (!token) {
		return { provider: "anthropic", displayName: "Claude", windows: [], error: "No credentials" };
	}

	try {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 5000);

		const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
			headers: {
				Authorization: `Bearer ${token}`,
				"anthropic-beta": "oauth-2025-04-20",
			},
			signal: controller.signal,
		});

		if (!res.ok) {
			return { provider: "anthropic", displayName: "Claude", windows: [], error: `HTTP ${res.status}` };
		}

		const data = (await res.json()) as any;
		const windows: any[] = [];

		if (data.five_hour?.utilization !== undefined) {
			windows.push({
				label: "5h",
				usedPercent: data.five_hour.utilization,
				resetDescription: data.five_hour.resets_at ? formatReset(new Date(data.five_hour.resets_at)) : undefined,
			});
		}

		if (data.seven_day?.utilization !== undefined) {
			windows.push({
				label: "Week",
				usedPercent: data.seven_day.utilization,
				resetDescription: data.seven_day.resets_at ? formatReset(new Date(data.seven_day.resets_at)) : undefined,
			});
		}

		const modelWindow = data.seven_day_sonnet || data.seven_day_opus;
		if (modelWindow?.utilization !== undefined) {
			windows.push({
				label: data.seven_day_sonnet ? "Sonnet" : "Opus",
				usedPercent: modelWindow.utilization,
			});
		}

		return { provider: "anthropic", displayName: "Claude", windows };
	} catch (e) {
		return { provider: "anthropic", displayName: "Claude", windows: [], error: String(e) };
	}
}
