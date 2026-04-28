import type { RateWindow, UsageSnapshot } from "./common";
import { formatReset, readPiAuth } from "./common";

function loadOpenRouterKey(): string | undefined {
	const auth = readPiAuth();
	if (auth?.openrouter?.key) return auth.openrouter.key;

	try {
		const fs = require("node:fs");
		const path = require("node:path");
		const opencodeAuthPath = path.join(require("node:os").homedir(), ".local", "share", "opencode", "auth.json");
		if (fs.existsSync(opencodeAuthPath)) {
			const data = JSON.parse(fs.readFileSync(opencodeAuthPath, "utf-8"));
			if (data.openrouter?.key) return data.openrouter.key;
		}
	} catch {}

	if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;

	return undefined;
}

export async function fetchOpenRouterUsage(): Promise<UsageSnapshot> {
	const apiKey = loadOpenRouterKey();
	if (!apiKey) {
		return { provider: "openrouter", displayName: "OpenRouter", windows: [], error: "No credentials" };
	}

	const headers: Record<string, string> = {
		Authorization: `Bearer ${apiKey}`,
		Accept: "application/json",
	};

	try {
		const controller1 = new AbortController();
		setTimeout(() => controller1.abort(), 6000);
		const controller2 = new AbortController();
		setTimeout(() => controller2.abort(), 6000);

		const [creditsRes, keyRes] = await Promise.all([
			fetch("https://openrouter.ai/api/v1/credits", { headers, signal: controller1.signal }),
			fetch("https://openrouter.ai/api/v1/key", { headers, signal: controller2.signal }),
		]);

		// Parse both responses upfront
		let creditsData: any = null;
		let keyData: any = null;

		if (creditsRes.ok) {
			try {
				creditsData = await creditsRes.json();
			} catch {}
		}

		if (keyRes.ok) {
			try {
				keyData = await keyRes.json();
			} catch {}
		}

		const windows: RateWindow[] = [];
		let plan: string | undefined;

		// Credits
		if (creditsData?.data) {
			const totalCredits = creditsData.data.total_credits ?? 0;
			const totalUsage = creditsData.data.total_usage ?? 0;
			const remaining = totalCredits - totalUsage;

			if (totalCredits > 0) {
				const usedPercent = Math.min(100, Math.max(0, (totalUsage / totalCredits) * 100));
				windows.push({
					label: "Credits",
					usedPercent,
					resetDescription: `$${remaining.toFixed(2)} left`,
				});
			}
		}

		// Key limits
		const d = keyData?.data;
		if (d) {
			const limit = d.limit;
			const limitRemaining = d.limit_remaining;
			const limitReset = d.limit_reset;

			if (limit && limit > 0 && typeof limitRemaining === "number") {
				const usedPercent = Math.min(100, Math.max(0, ((limit - limitRemaining) / limit) * 100));
				windows.push({
					label: "Rate",
					usedPercent,
					resetDescription: limitReset ? formatReset(new Date(limitReset)) : undefined,
					resetsAt: limitReset ? new Date(limitReset) : undefined,
				});
			}

			if (d.is_free_tier) {
				plan = "Free";
			} else if (d.label) {
				plan = d.label;
			}
		}

		if (windows.length === 0 && !creditsRes.ok) {
			return {
				provider: "openrouter",
				displayName: "OpenRouter",
				windows: [],
				error: `Credits: HTTP ${creditsRes.status}`,
			};
		}

		if (windows.length === 0 && !keyRes.ok) {
			return { provider: "openrouter", displayName: "OpenRouter", windows: [], error: `Key: HTTP ${keyRes.status}` };
		}

		return { provider: "openrouter", displayName: "OpenRouter", windows, plan };
	} catch (e) {
		return { provider: "openrouter", displayName: "OpenRouter", windows: [], error: String(e) };
	}
}
