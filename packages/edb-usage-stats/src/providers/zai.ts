import type { UsageSnapshot } from "./common";
import { formatReset, readPiAuth } from "./common";

export async function fetchZaiUsage(): Promise<UsageSnapshot> {
	let apiKey = process.env.Z_AI_API_KEY;

	if (!apiKey) {
		const auth = readPiAuth();
		apiKey = auth?.["z-ai"]?.access || auth?.zai?.access;
	}

	if (!apiKey) {
		return { provider: "zai", displayName: "z.ai", windows: [], error: "No API key" };
	}

	try {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 5000);

		const res = await fetch("https://api.z.ai/api/monitor/usage/quota/limit", {
			method: "GET",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
			},
			signal: controller.signal,
		});

		if (!res.ok) {
			return { provider: "zai", displayName: "z.ai", windows: [], error: `HTTP ${res.status}` };
		}

		const data = (await res.json()) as any;
		if (!data.success || data.code !== 200) {
			return { provider: "zai", displayName: "z.ai", windows: [], error: data.msg || "API error" };
		}

		const windows: any[] = [];
		const limits = data.data?.limits || [];

		for (const limit of limits) {
			const type = limit.type;
			const percent = limit.percentage || 0;
			const nextReset = limit.nextResetTime ? new Date(limit.nextResetTime) : undefined;

			let windowLabel = "Limit";
			if (limit.unit === 1) windowLabel = `${limit.number}d`;
			else if (limit.unit === 3) windowLabel = `${limit.number}h`;
			else if (limit.unit === 5) windowLabel = `${limit.number}m`;

			if (type === "TOKENS_LIMIT") {
				windows.push({
					label: `Tokens (${windowLabel})`,
					usedPercent: percent,
					resetDescription: nextReset ? formatReset(nextReset) : undefined,
				});
			} else if (type === "TIME_LIMIT") {
				windows.push({
					label: "Monthly",
					usedPercent: percent,
					resetDescription: nextReset ? formatReset(nextReset) : undefined,
				});
			}
		}

		const planName = data.data?.planName || data.data?.plan || undefined;
		return { provider: "zai", displayName: "z.ai", windows, plan: planName };
	} catch (e) {
		return { provider: "zai", displayName: "z.ai", windows: [], error: String(e) };
	}
}
