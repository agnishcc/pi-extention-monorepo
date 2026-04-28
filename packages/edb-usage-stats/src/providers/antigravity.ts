import type { UsageSnapshot } from "./common";
import { formatReset, readPiAuth } from "./common";

interface AntigravityAuth {
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number;
	projectId?: string;
}

function loadAntigravityAuthFromPi(): AntigravityAuth | undefined {
	const auth = readPiAuth();
	const cred = auth?.["google-antigravity"] ?? auth?.antigravity ?? auth?.["anti-gravity"];
	if (!cred) return undefined;

	const accessToken = typeof cred.access === "string" ? cred.access : undefined;
	if (!accessToken) return undefined;

	return {
		accessToken,
		refreshToken: typeof cred.refresh === "string" ? cred.refresh : undefined,
		expiresAt: typeof cred.expires === "number" ? cred.expires : undefined,
		projectId:
			typeof cred.projectId === "string"
				? cred.projectId
				: typeof cred.project_id === "string"
					? cred.project_id
					: undefined,
	};
}

async function loadAntigravityAuth(modelRegistry: any): Promise<AntigravityAuth | undefined> {
	try {
		const accessToken = await Promise.resolve(modelRegistry?.authStorage?.getApiKey?.("google-antigravity"));
		const raw = await Promise.resolve(modelRegistry?.authStorage?.get?.("google-antigravity"));

		const projectId = typeof raw?.projectId === "string" ? raw.projectId : undefined;
		const refreshToken = typeof raw?.refresh === "string" ? raw.refresh : undefined;
		const expiresAt = typeof raw?.expires === "number" ? raw.expires : undefined;

		if (typeof accessToken === "string" && accessToken.length > 0) {
			return { accessToken, projectId, refreshToken, expiresAt };
		}
	} catch {}

	const fromPi = loadAntigravityAuthFromPi();
	if (fromPi) return fromPi;

	if (process.env.ANTIGRAVITY_API_KEY) {
		return { accessToken: process.env.ANTIGRAVITY_API_KEY };
	}

	return undefined;
}

async function refreshAntigravityToken(
	refreshToken: string,
): Promise<{ accessToken: string; expiresAt?: number } | null> {
	try {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 5000);

		const clientId = process.env.ANTIGRAVITY_CLIENT_ID;
		const clientSecret = process.env.ANTIGRAVITY_CLIENT_SECRET;
		if (!clientId || !clientSecret) return null;

		const res = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: clientId,
				client_secret: clientSecret,
				refresh_token: refreshToken,
				grant_type: "refresh_token",
			}).toString(),
			signal: controller.signal,
		});

		if (!res.ok) return null;
		const data = (await res.json()) as any;
		const accessToken = typeof data.access_token === "string" ? data.access_token : undefined;
		if (!accessToken) return null;
		const expiresIn = typeof data.expires_in === "number" ? data.expires_in : undefined;
		return { accessToken, expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined };
	} catch {
		return null;
	}
}

export async function fetchAntigravityUsage(modelRegistry: any): Promise<UsageSnapshot> {
	const auth = await loadAntigravityAuth(modelRegistry);
	if (!auth?.accessToken) {
		return { provider: "antigravity", displayName: "Antigravity", windows: [], error: "No credentials" };
	}

	if (!auth.projectId) {
		return { provider: "antigravity", displayName: "Antigravity", windows: [], error: "Missing projectId" };
	}

	let accessToken = auth.accessToken;

	if (auth.refreshToken && auth.expiresAt && auth.expiresAt < Date.now() + 5 * 60 * 1000) {
		const refreshed = await refreshAntigravityToken(auth.refreshToken);
		if (refreshed?.accessToken) accessToken = refreshed.accessToken;
	}

	const fetchModels = async (token: string): Promise<Response> => {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 5000);

		return fetch("https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
				"User-Agent": "antigravity/1.12.4",
				"X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
				Accept: "application/json",
			},
			body: JSON.stringify({ project: auth.projectId }),
			signal: controller.signal,
		});
	};

	try {
		let res = await fetchModels(accessToken);

		if ((res.status === 401 || res.status === 403) && auth.refreshToken) {
			const refreshed = await refreshAntigravityToken(auth.refreshToken);
			if (refreshed?.accessToken) {
				accessToken = refreshed.accessToken;
				res = await fetchModels(accessToken);
			}
		}

		if (res.status === 401 || res.status === 403) {
			return { provider: "antigravity", displayName: "Antigravity", windows: [], error: "Unauthorized" };
		}

		if (!res.ok) {
			return { provider: "antigravity", displayName: "Antigravity", windows: [], error: `HTTP ${res.status}` };
		}

		const data = (await res.json()) as any;
		const models: Record<string, any> = data.models || {};

		const getQuotaInfo = (modelKeys: string[]): { usedPercent: number; resetDescription?: string } | null => {
			for (const key of modelKeys) {
				const qi = models?.[key]?.quotaInfo;
				if (!qi) continue;
				const remainingFraction = typeof qi.remainingFraction === "number" ? qi.remainingFraction : 0;
				const usedPercent = Math.min(100, Math.max(0, (1 - remainingFraction) * 100));
				const resetTime = qi.resetTime ? new Date(qi.resetTime) : undefined;
				return { usedPercent, resetDescription: resetTime ? formatReset(resetTime) : undefined };
			}
			return null;
		};

		const windows: any[] = [];

		const claudeOrGptOss = getQuotaInfo([
			"claude-sonnet-4-5",
			"claude-sonnet-4-5-thinking",
			"claude-opus-4-5-thinking",
			"gpt-oss-120b-medium",
		]);
		if (claudeOrGptOss) {
			windows.push({
				label: "Claude",
				usedPercent: claudeOrGptOss.usedPercent,
				resetDescription: claudeOrGptOss.resetDescription,
			});
		}

		const gemini3Pro = getQuotaInfo(["gemini-3-pro-high", "gemini-3-pro-low", "gemini-3-pro-preview"]);
		if (gemini3Pro) {
			windows.push({
				label: "G3 Pro",
				usedPercent: gemini3Pro.usedPercent,
				resetDescription: gemini3Pro.resetDescription,
			});
		}

		const gemini3Flash = getQuotaInfo(["gemini-3-flash"]);
		if (gemini3Flash) {
			windows.push({
				label: "G3 Flash",
				usedPercent: gemini3Flash.usedPercent,
				resetDescription: gemini3Flash.resetDescription,
			});
		}

		if (windows.length === 0) {
			return { provider: "antigravity", displayName: "Antigravity", windows: [], error: "No quota data" };
		}

		return { provider: "antigravity", displayName: "Antigravity", windows };
	} catch (e) {
		return { provider: "antigravity", displayName: "Antigravity", windows: [], error: String(e) };
	}
}
