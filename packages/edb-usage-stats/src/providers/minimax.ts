import * as os from "node:os";
import * as path from "node:path";
import type { RateWindow, UsageSnapshot } from "./common";
import { formatReset, readPiAuth } from "./common";

function loadMinimaxApiKey(): string | undefined {
	// pi auth.json first
	const auth = readPiAuth();
	if (auth?.["minimax-coding-plan"]?.key) return auth["minimax-coding-plan"].key;
	if (auth?.minimax?.key) return auth.minimax.key;

	// Fallback to opencode auth
	const opencodeAuthPath = path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
	try {
		const fs = require("node:fs");
		if (fs.existsSync(opencodeAuthPath)) {
			const data = JSON.parse(fs.readFileSync(opencodeAuthPath, "utf-8"));
			if (data["minimax-coding-plan"]?.key) return data["minimax-coding-plan"].key;
		}
	} catch {}

	// Environment variable fallback
	if (process.env.MINIMAX_API_KEY) return process.env.MINIMAX_API_KEY;

	return undefined;
}

export async function fetchMinimaxUsage(): Promise<UsageSnapshot> {
	const apiKey = loadMinimaxApiKey();
	if (!apiKey) {
		return { provider: "minimax", displayName: "MiniMax", windows: [], error: "No credentials" };
	}

	const endpoints = [
		"https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
		"https://www.minimax.io/v1/api/openplatform/coding_plan/remains",
	];

	for (const endpoint of endpoints) {
		try {
			const controller = new AbortController();
			setTimeout(() => controller.abort(), 6000);

			const res = await fetch(endpoint, {
				headers: {
					Authorization: `Bearer ${apiKey}`,
					Accept: "application/json",
					"Content-Type": "application/json",
				},
				signal: controller.signal,
			});

			if (!res.ok) continue;

			const data = (await res.json()) as any;

			// Validate response structure
			if (data.base_resp?.status_code !== 0 || !Array.isArray(data.model_remains)) {
				continue;
			}

			const models = data.model_remains;
			if (models.length === 0) continue;

			const windows: RateWindow[] = [];

			// Show the primary model's windows
			const primary = models[0];
			const intervalTotal = primary.current_interval_total_count ?? 0;
			const intervalRemaining = primary.current_interval_usage_count ?? 0;
			const intervalRemainsMs = primary.remains_time ?? 0;
			const weeklyTotal = primary.current_weekly_total_count ?? 0;
			const weeklyRemaining = primary.current_weekly_usage_count ?? 0;
			const weeklyRemainsMs = primary.weekly_remains_time ?? 0;

			if (intervalTotal > 0) {
				const usedPercent = Math.max(0, Math.min(100, ((intervalTotal - intervalRemaining) / intervalTotal) * 100));
				windows.push({
					label: "5h",
					usedPercent,
					resetDescription:
						intervalRemainsMs > 0 ? formatReset(new Date(Date.now() + intervalRemainsMs)) : undefined,
					resetsAt: primary.end_time ? new Date(primary.end_time) : undefined,
				});
			}

			if (weeklyTotal > 0) {
				const usedPercent = Math.max(0, Math.min(100, ((weeklyTotal - weeklyRemaining) / weeklyTotal) * 100));
				windows.push({
					label: "Week",
					usedPercent,
					resetDescription: weeklyRemainsMs > 0 ? formatReset(new Date(Date.now() + weeklyRemainsMs)) : undefined,
					resetsAt: primary.weekly_end_time ? new Date(primary.weekly_end_time) : undefined,
				});
			}

			// Additional models with different limits get their own rows
			for (let i = 1; i < models.length; i++) {
				const m = models[i];
				const mName = (m.model_name ?? "").replace(/^MiniMax-/, "").substring(0, 12);
				const mTotal = m.current_interval_total_count ?? 0;
				const mRemaining = m.current_interval_usage_count ?? 0;
				const mRemainsMs = m.remains_time ?? 0;

				if (mTotal > 0) {
					const usedPercent = Math.max(0, Math.min(100, ((mTotal - mRemaining) / mTotal) * 100));
					windows.push({
						label: mName || `M${i}`,
						usedPercent,
						resetDescription: mRemainsMs > 0 ? formatReset(new Date(Date.now() + mRemainsMs)) : undefined,
					});
				}
			}

			return { provider: "minimax", displayName: "MiniMax", windows };
		} catch {}
	}

	return { provider: "minimax", displayName: "MiniMax", windows: [], error: "Failed to fetch" };
}
