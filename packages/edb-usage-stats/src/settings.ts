import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface UsageSettings {
	/** Provider keys that are explicitly enabled. Empty array = all disabled. */
	enabledProviders: string[];
}

const SETTINGS_DIR = path.join(os.homedir(), ".pi", "agent", "extensions", "pi-usage-stats");
const SETTINGS_FILE = path.join(SETTINGS_DIR, "settings.json");

const ALL_PROVIDERS = [
	"anthropic",
	"copilot",
	"gemini",
	"antigravity",
	"codex",
	"minimax",
	"openrouter",
	"kiro",
	"zai",
];

export function getAllProviders(): string[] {
	return [...ALL_PROVIDERS];
}

export function loadSettings(): UsageSettings {
	try {
		if (fs.existsSync(SETTINGS_FILE)) {
			const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
			return {
				enabledProviders: Array.isArray(data.enabledProviders) ? data.enabledProviders : [],
			};
		}
	} catch {}
	// Default: all providers disabled — user must opt in
	return { enabledProviders: [] };
}

export function saveSettings(settings: UsageSettings): void {
	try {
		if (!fs.existsSync(SETTINGS_DIR)) {
			fs.mkdirSync(SETTINGS_DIR, { recursive: true });
		}
		fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
	} catch {}
}

export function isProviderEnabled(provider: string, settings: UsageSettings): boolean {
	return settings.enabledProviders.includes(provider);
}
