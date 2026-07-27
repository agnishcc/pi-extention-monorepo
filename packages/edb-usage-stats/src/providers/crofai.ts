import type { RateWindow, UsageSnapshot } from "./common";
import { formatReset, readPiAuth } from "./common";

function loadCrofAiApiKey(): string | undefined {
	// pi auth.json first
	const auth = readPiAuth();
	if (auth?.crofai?.key) return auth.crofai.key;
	if (auth?.crofai?.access) return auth.crofai.access;

	// Environment variable fallback
	if (process.env.CROFAI_API_KEY) return process.env.CROFAI_API_KEY;

	return undefined;
}

export async function fetchCrofAiUsage(): Promise<UsageSnapshot> {
	const apiKey = loadCrofAiApiKey();
	if (!apiKey) {
		return { provider: "crofai", displayName: "CrofAi", windows: [], error: "No credentials" };
	}

	try {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 6000);

		const res = await fetch("https://crof.ai/usage_api/", {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
			},
			signal: controller.signal,
		});

		if (!res.ok) {
			return {
				provider: "crofai",
				displayName: "CrofAi",
				windows: [],
				error: `HTTP ${res.status}`,
			};
		}

		const data = (await res.json()) as any;
		const usableRequests = data.usable_requests;
		const dailyTotal = 500;

		// Calculate next reset: 10:30 AM IST = 05:00 UTC daily
		const now = new Date();
		const todayReset = new Date(now);
		todayReset.setUTCHours(5, 0, 0, 0); // 05:00 UTC = 10:30 IST
		const nextReset =
			now >= todayReset
				? new Date(todayReset.getTime() + 24 * 60 * 60 * 1000) // tomorrow
				: todayReset;
		const resetDesc = formatReset(nextReset);

		const windows: RateWindow[] = [];
		if (usableRequests !== null) {
			const used = dailyTotal - usableRequests;
			const usedPercent = Math.max(0, Math.min(100, (used / dailyTotal) * 100));
			windows.push({
				label: "Daily",
				usedPercent,
				resetDescription: `Resets in ${resetDesc} (${dailyTotal - used}/${dailyTotal})`,
				resetsAt: nextReset,
			});
		}

		return { provider: "crofai", displayName: "CrofAi", windows };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to fetch";
		return { provider: "crofai", displayName: "CrofAi", windows: [], error: message };
	}
}
