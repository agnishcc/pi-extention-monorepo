import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { UsageSnapshot } from "./common";
import { readPiAuth } from "./common";

export async function fetchGeminiUsage(_modelRegistry: any): Promise<UsageSnapshot> {
	let token: string | undefined;

	const auth = readPiAuth();
	token = auth?.["google-gemini-cli"]?.access;

	if (!token) {
		const credPath = path.join(os.homedir(), ".gemini", "oauth_creds.json");
		try {
			if (fs.existsSync(credPath)) {
				const data = JSON.parse(fs.readFileSync(credPath, "utf-8"));
				token = data.access_token;
			}
		} catch {}
	}

	if (!token) {
		return { provider: "gemini", displayName: "Gemini", windows: [], error: "No credentials" };
	}

	try {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 5000);

		const res = await fetch("https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota", {
			method: "POST",
			headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
			body: "{}",
			signal: controller.signal,
		});

		if (!res.ok) {
			return { provider: "gemini", displayName: "Gemini", windows: [], error: `HTTP ${res.status}` };
		}

		const data = (await res.json()) as any;
		const quotas: Record<string, number> = {};

		for (const bucket of data.buckets || []) {
			const model = bucket.modelId || "unknown";
			const frac = bucket.remainingFraction ?? 1;
			if (!quotas[model] || frac < quotas[model]) quotas[model] = frac;
		}

		const windows: any[] = [];
		let proMin = 1,
			flashMin = 1;
		let hasProModel = false,
			hasFlashModel = false;

		for (const [model, frac] of Object.entries(quotas)) {
			if (model.toLowerCase().includes("pro")) {
				hasProModel = true;
				if (frac < proMin) proMin = frac;
			}
			if (model.toLowerCase().includes("flash")) {
				hasFlashModel = true;
				if (frac < flashMin) flashMin = frac;
			}
		}

		if (hasProModel) windows.push({ label: "Pro", usedPercent: (1 - proMin) * 100 });
		if (hasFlashModel) windows.push({ label: "Flash", usedPercent: (1 - flashMin) * 100 });

		return { provider: "gemini", displayName: "Gemini", windows };
	} catch (e) {
		return { provider: "gemini", displayName: "Gemini", windows: [], error: String(e) };
	}
}
