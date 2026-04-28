import type { UsageSnapshot } from "./common";
import { formatReset, readPiAuth } from "./common";

function loadCopilotRefreshToken(): string | undefined {
	const auth = readPiAuth();
	return auth?.["github-copilot"]?.refresh;
}

export async function fetchCopilotUsage(_modelRegistry: any): Promise<UsageSnapshot> {
	const token = loadCopilotRefreshToken();
	if (!token) {
		return { provider: "copilot", displayName: "Copilot", windows: [], error: "No token" };
	}

	const headersBase = {
		"Editor-Version": "vscode/1.96.2",
		"User-Agent": "GitHubCopilotChat/0.26.7",
		"X-Github-Api-Version": "2025-04-01",
		Accept: "application/json",
	};

	const tryFetch = async (authHeader: string) => {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 5000);

		const res = await fetch("https://api.github.com/copilot_internal/user", {
			headers: { ...headersBase, Authorization: authHeader },
			signal: controller.signal,
		});
		return res;
	};

	try {
		const attempts = [`token ${token}`];
		let lastStatus: number | undefined;
		let res: Response | undefined;

		for (const auth of attempts) {
			res = await tryFetch(auth);
			lastStatus = res.status;
			if (res.ok) break;
			if (res.status === 401 || res.status === 403) continue;
			break;
		}

		if (!res || !res.ok) {
			const status = lastStatus ?? 0;
			return { provider: "copilot", displayName: "Copilot", windows: [], error: `HTTP ${status}` };
		}

		const data = (await res.json()) as any;
		const windows: any[] = [];

		const resetDate = data.quota_reset_date_utc ? new Date(data.quota_reset_date_utc) : undefined;
		const resetDesc = resetDate ? formatReset(resetDate) : undefined;

		if (data.quota_snapshots?.premium_interactions) {
			const pi = data.quota_snapshots.premium_interactions;
			const remaining = pi.remaining ?? 0;
			const entitlement = pi.entitlement ?? 0;
			const usedPercent = Math.max(0, 100 - (pi.percent_remaining || 0));
			windows.push({
				label: "Premium",
				usedPercent,
				resetDescription: resetDesc ? `${resetDesc} (${remaining}/${entitlement})` : `${remaining}/${entitlement}`,
			});
		}

		if (data.quota_snapshots?.chat && !data.quota_snapshots.chat.unlimited) {
			const chat = data.quota_snapshots.chat;
			windows.push({
				label: "Chat",
				usedPercent: Math.max(0, 100 - (chat.percent_remaining || 0)),
				resetDescription: resetDesc,
			});
		}

		return {
			provider: "copilot",
			displayName: "Copilot",
			windows,
			plan: data.copilot_plan,
		};
	} catch (e) {
		return { provider: "copilot", displayName: "Copilot", windows: [], error: String(e) };
	}
}
