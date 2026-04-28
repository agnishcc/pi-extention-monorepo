// Shared types and helpers for usage providers

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

export interface RateWindow {
	label: string;
	usedPercent: number;
	resetDescription?: string;
	resetsAt?: Date;
}

export interface ProviderStatus {
	indicator: "none" | "minor" | "major" | "critical" | "maintenance" | "unknown";
	description?: string;
}

export interface UsageSnapshot {
	provider: string;
	displayName: string;
	windows: RateWindow[];
	plan?: string;
	error?: string;
	status?: ProviderStatus;
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function formatReset(date: Date): string {
	const diffMs = date.getTime() - Date.now();
	if (diffMs < 0) return "now";

	const diffMins = Math.floor(diffMs / 60000);
	if (diffMins < 60) return `${diffMins}m`;

	const hours = Math.floor(diffMins / 60);
	const mins = diffMins % 60;
	if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;

	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d ${hours % 24}h`;

	return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

export function getStatusEmoji(status?: ProviderStatus): string {
	if (!status) return "";
	switch (status.indicator) {
		case "none":
			return "✅";
		case "minor":
			return "⚠️";
		case "major":
			return "🟠";
		case "critical":
			return "🔴";
		case "maintenance":
			return "🔧";
		default:
			return "";
	}
}

export function timeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
	return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

export function stripAnsi(text: string): string {
	return text.replace(/\x1B\[[0-9;?]*[A-Za-z]|\x1B\].*?\x07/g, "");
}

export function whichSync(cmd: string): string | null {
	try {
		return execSync(`which ${cmd}`, { encoding: "utf-8" }).trim();
	} catch {
		return null;
	}
}

// ── Auth Helpers ───────────────────────────────────────────────────────────

export function readPiAuth(): Record<string, any> | null {
	const piAuthPath = path.join(os.homedir(), ".pi", "agent", "auth.json");
	try {
		if (fs.existsSync(piAuthPath)) {
			return JSON.parse(fs.readFileSync(piAuthPath, "utf-8"));
		}
	} catch {}
	return null;
}

export function loadApiKeyFromPiAuth(provider: string): string | undefined {
	const auth = readPiAuth();
	return auth?.[provider]?.access;
}

// ── Status Polling ─────────────────────────────────────────────────────────

const STATUS_URLS: Record<string, string> = {
	anthropic: "https://status.anthropic.com/api/v2/status.json",
	codex: "https://status.openai.com/api/v2/status.json",
	copilot: "https://www.githubstatus.com/api/v2/status.json",
};

export async function fetchProviderStatus(provider: string): Promise<ProviderStatus> {
	const url = STATUS_URLS[provider];
	if (!url) return { indicator: "none" };

	try {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 5000);

		const res = await fetch(url, { signal: controller.signal });
		if (!res.ok) return { indicator: "unknown" };

		const data = (await res.json()) as any;
		const indicator = data.status?.indicator || "none";
		const description = data.status?.description;

		return { indicator: indicator as ProviderStatus["indicator"], description };
	} catch {
		return { indicator: "unknown" };
	}
}

export async function fetchGeminiStatus(): Promise<ProviderStatus> {
	try {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 5000);

		const res = await fetch("https://www.google.com/appsstatus/dashboard/incidents.json", {
			signal: controller.signal,
		});
		if (!res.ok) return { indicator: "unknown" };

		const incidents = (await res.json()) as any[];

		const geminiProductId = "npdyhgECDJ6tB66MxXyo";
		const activeIncidents = incidents.filter((inc: any) => {
			if (inc.end) return false;
			const affected = inc.currently_affected_products || inc.affected_products || [];
			return affected.some((p: any) => p.id === geminiProductId);
		});

		if (activeIncidents.length === 0) return { indicator: "none" };

		let worstIndicator: ProviderStatus["indicator"] = "minor";
		let description: string | undefined;

		for (const inc of activeIncidents) {
			const status = inc.most_recent_update?.status || inc.status_impact;
			if (status === "SERVICE_OUTAGE") {
				worstIndicator = "critical";
				description = inc.external_desc;
			} else if (status === "SERVICE_DISRUPTION" && worstIndicator !== "critical") {
				worstIndicator = "major";
				description = inc.external_desc;
			}
		}

		return { indicator: worstIndicator, description };
	} catch {
		return { indicator: "unknown" };
	}
}
