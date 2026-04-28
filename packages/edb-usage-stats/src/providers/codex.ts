import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { UsageSnapshot } from "./common";
import { formatReset } from "./common";

export async function fetchCodexUsage(modelRegistry: any): Promise<UsageSnapshot> {
	let accessToken: string | undefined;
	let accountId: string | undefined;

	try {
		accessToken = await modelRegistry?.authStorage?.getApiKey?.("openai-codex");
		const cred = modelRegistry?.authStorage?.get?.("openai-codex");
		if (cred?.type === "oauth") {
			accountId = (cred as any).accountId;
		}
	} catch {}

	if (!accessToken) {
		const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
		const authPath = path.join(codexHome, "auth.json");

		try {
			if (fs.existsSync(authPath)) {
				const data = JSON.parse(fs.readFileSync(authPath, "utf-8"));
				if (data.OPENAI_API_KEY) {
					accessToken = data.OPENAI_API_KEY;
				} else if (data.tokens?.access_token) {
					accessToken = data.tokens.access_token;
					accountId = data.tokens.account_id;
				}
			}
		} catch {}
	}

	if (!accessToken) {
		return { provider: "codex", displayName: "Codex", windows: [], error: "No credentials" };
	}

	try {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 5000);

		const headers: Record<string, string> = {
			Authorization: `Bearer ${accessToken}`,
			"User-Agent": "CodexBar",
			Accept: "application/json",
		};

		if (accountId) {
			headers["ChatGPT-Account-Id"] = accountId;
		}

		const res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
			method: "GET",
			headers,
			signal: controller.signal,
		});

		if (res.status === 401 || res.status === 403) {
			return { provider: "codex", displayName: "Codex", windows: [], error: "Token expired" };
		}

		if (!res.ok) {
			return { provider: "codex", displayName: "Codex", windows: [], error: `HTTP ${res.status}` };
		}

		const data = (await res.json()) as any;
		const windows: any[] = [];

		if (data.rate_limit?.primary_window) {
			const pw = data.rate_limit.primary_window;
			const resetDate = pw.reset_at ? new Date(pw.reset_at * 1000) : undefined;
			const windowHours = Math.round((pw.limit_window_seconds || 10800) / 3600);
			windows.push({
				label: `${windowHours}h`,
				usedPercent: pw.used_percent || 0,
				resetDescription: resetDate ? formatReset(resetDate) : undefined,
			});
		}

		if (data.rate_limit?.secondary_window) {
			const sw = data.rate_limit.secondary_window;
			const resetDate = sw.reset_at ? new Date(sw.reset_at * 1000) : undefined;
			const windowHours = Math.round((sw.limit_window_seconds || 86400) / 3600);
			const label = windowHours >= 24 ? "Day" : `${windowHours}h`;
			windows.push({
				label,
				usedPercent: sw.used_percent || 0,
				resetDescription: resetDate ? formatReset(resetDate) : undefined,
			});
		}

		let plan = data.plan_type;
		if (data.credits?.balance !== undefined && data.credits.balance !== null) {
			const balance =
				typeof data.credits.balance === "number" ? data.credits.balance : parseFloat(data.credits.balance) || 0;
			plan = plan ? `${plan} ($${balance.toFixed(2)})` : `$${balance.toFixed(2)}`;
		}

		return { provider: "codex", displayName: "Codex", windows, plan };
	} catch (e) {
		return { provider: "codex", displayName: "Codex", windows: [], error: String(e) };
	}
}
