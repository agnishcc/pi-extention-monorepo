import { DynamicBorder, getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import { Container, Key, matchesKey, type SettingItem, SettingsList, Text, visibleWidth } from "@mariozechner/pi-tui";
import { fetchAntigravityUsage } from "./providers/antigravity";
import { fetchClaudeUsage } from "./providers/claude";
import { fetchCodexUsage } from "./providers/codex";
import type { ProviderStatus, UsageSnapshot } from "./providers/common";
import { fetchGeminiStatus, fetchProviderStatus, getStatusEmoji, timeout } from "./providers/common";
import { fetchCopilotUsage } from "./providers/copilot";
import { fetchGeminiUsage } from "./providers/gemini";
import { fetchKiroUsage } from "./providers/kiro";
import { fetchMinimaxUsage } from "./providers/minimax";
import { fetchOpenRouterUsage } from "./providers/openrouter";
import { fetchZaiUsage } from "./providers/zai";
import { getAllProviders, isProviderEnabled, loadSettings, saveSettings, type UsageSettings } from "./settings";

// ── Provider registries ──────────────────────────────────────────────────────

export const PROVIDER_DISPLAY: Record<string, string> = {
	anthropic: "Claude",
	copilot: "Copilot",
	gemini: "Gemini",
	antigravity: "Antigravity",
	codex: "Codex",
	minimax: "MiniMax",
	openrouter: "OpenRouter",
	kiro: "Kiro",
	zai: "z.ai",
};

type ProviderFetcher = (modelRegistry?: any) => Promise<UsageSnapshot>;
type StatusFetcher = () => Promise<ProviderStatus>;

const FETCHERS: Record<string, ProviderFetcher> = {
	anthropic: () => fetchClaudeUsage(),
	copilot: (mr) => fetchCopilotUsage(mr),
	gemini: (mr) => fetchGeminiUsage(mr),
	codex: (mr) => fetchCodexUsage(mr),
	antigravity: (mr) => fetchAntigravityUsage(mr),
	minimax: () => fetchMinimaxUsage(),
	openrouter: () => fetchOpenRouterUsage(),
	kiro: () => fetchKiroUsage(),
	zai: () => fetchZaiUsage(),
};

const STATUS_FETCHERS: Record<string, StatusFetcher> = {
	anthropic: () => fetchProviderStatus("anthropic"),
	copilot: () => fetchProviderStatus("copilot"),
	gemini: () => fetchGeminiStatus(),
	codex: () => fetchProviderStatus("codex"),
};

const IGNORABLE_ERRORS = new Set(["No credentials", "kiro-cli not found", "No API key"]);

// ── Settings View ────────────────────────────────────────────────────────────

function createSettingsView(settings: UsageSettings, tui: any, theme: any, onBack: () => void) {
	const providers = getAllProviders();
	let currentSettings: UsageSettings = { enabledProviders: [...settings.enabledProviders] };

	const items: SettingItem[] = providers.map((p) => ({
		id: p,
		label: PROVIDER_DISPLAY[p] ?? p,
		currentValue: isProviderEnabled(p, currentSettings) ? "enabled" : "disabled",
		values: ["enabled", "disabled"] as [string, ...string[]],
	}));

	const container = new Container();
	container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
	container.addChild(new Text(theme.fg("accent", theme.bold(" Configure Providers")), 1, 0));
	container.addChild(new Text(theme.fg("dim", " Enter toggle · ↑↓ navigate · Esc back"), 1, 0));
	container.addChild(new Text("", 0, 0));

	const settingsList = new SettingsList(
		items,
		Math.min(providers.length + 2, 12),
		getSettingsListTheme(),
		(id, newValue) => {
			const eps = [...currentSettings.enabledProviders];
			if (newValue === "enabled") {
				if (!eps.includes(id)) eps.push(id);
			} else {
				const idx = eps.indexOf(id);
				if (idx >= 0) eps.splice(idx, 1);
			}
			currentSettings = { enabledProviders: eps };
			saveSettings(currentSettings);
		},
		onBack,
	);
	container.addChild(settingsList);
	container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

	return {
		render(width: number): string[] {
			return container.render(width);
		},
		handleInput(data: string): void {
			settingsList.handleInput?.(data);
			tui.requestRender();
		},
		invalidate(): void {
			container.invalidate();
		},
	};
}

// ── Usage Component ──────────────────────────────────────────────────────────

type UsageView = "loading" | "usage" | "settings";

export class UsageComponent {
	private usages: UsageSnapshot[] = [];
	private view: UsageView = "loading";
	private settings: UsageSettings;
	private settingsView: ReturnType<typeof createSettingsView> | null = null;
	private tui: { requestRender: () => void };
	private theme: any;
	private modelRegistry: any;
	private done: () => void;

	constructor(tui: { requestRender: () => void }, theme: any, modelRegistry: any, done: () => void) {
		this.tui = tui;
		this.theme = theme;
		this.modelRegistry = modelRegistry;
		this.done = done;
		this.settings = loadSettings();
		this.load();
	}

	private async load() {
		const enabled = this.settings.enabledProviders;

		if (enabled.length === 0) {
			this.usages = [];
			this.view = "usage";
			this.tui.requestRender();
			return;
		}

		this.view = "loading";
		this.tui.requestRender();

		const fetchTimeout = 6000;
		const statusTimeout = 3000;

		const [usages, statuses] = await Promise.all([
			Promise.all(
				enabled.map((p) => {
					const fn = FETCHERS[p];
					const fallback: UsageSnapshot = {
						provider: p,
						displayName: PROVIDER_DISPLAY[p] ?? p,
						windows: [],
						error: "Timeout",
					};
					return fn
						? timeout(fn(this.modelRegistry), fetchTimeout, fallback)
						: Promise.resolve<UsageSnapshot>({ ...fallback, error: "Unknown provider" });
				}),
			),
			Promise.all(
				enabled.map((p) => {
					const fn = STATUS_FETCHERS[p];
					const fallback: ProviderStatus = { indicator: "unknown" as const };
					return fn
						? timeout(fn(), statusTimeout, fallback)
						: Promise.resolve<ProviderStatus>({ indicator: "none" });
				}),
			),
		]);

		usages.forEach((u, i) => {
			const s = statuses[i];
			if (s) u.status = s;
		});

		this.usages = usages.filter((u) => u.windows.length > 0 || !IGNORABLE_ERRORS.has(u.error ?? ""));
		this.view = "usage";
		this.tui.requestRender();
	}

	private openSettings(): void {
		this.settingsView = createSettingsView(this.settings, this.tui, this.theme, () => {
			// Reload with updated settings, then return to usage view
			this.settings = loadSettings();
			this.settingsView = null;
			this.load();
		});
		this.view = "settings";
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (this.view === "settings" && this.settingsView) {
			this.settingsView.handleInput(data);
			return;
		}

		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.done();
			return;
		}

		if (data === "s") {
			this.openSettings();
			return;
		}

		if (data === "r" && this.view !== "loading") {
			this.settings = loadSettings();
			this.load();
			return;
		}

		// All other keys ignored (no accidental close)
	}

	invalidate(): void {
		this.settingsView?.invalidate();
	}

	render(width: number): string[] {
		if (this.view === "settings" && this.settingsView) {
			return this.settingsView.render(width);
		}
		return this.renderUsage(width);
	}

	private renderUsage(width: number): string[] {
		const t = this.theme;
		const dim = (s: string) => t.fg("muted", s);
		const bold = (s: string) => t.bold(s);
		const accent = (s: string) => t.fg("accent", s);

		const totalW = Math.min(55, width - 4);
		const innerW = totalW - 4;
		const hLine = "─".repeat(totalW - 2);

		const box = (content: string) => {
			const contentW = visibleWidth(content);
			const pad = Math.max(0, innerW - contentW);
			return dim("│ ") + content + " ".repeat(pad) + dim(" │");
		};

		const lines: string[] = [];
		lines.push(dim(`╭${hLine}╮`));
		lines.push(box(bold(accent("AI Usage"))));
		lines.push(dim(`├${hLine}┤`));

		if (this.view === "loading") {
			lines.push(box(""));
			lines.push(box(t.fg("dim", "  Fetching…")));
			lines.push(box(""));
		} else if (this.usages.length === 0) {
			lines.push(box(""));
			lines.push(box(t.fg("dim", "  No providers enabled.")));
			lines.push(box(t.fg("dim", "  Press ") + t.fg("accent", "s") + t.fg("dim", " to configure.")));
			lines.push(box(""));
		} else {
			for (const u of this.usages) {
				const statusEmoji = getStatusEmoji(u.status);
				const planStr = u.plan ? dim(` (${u.plan})`) : "";
				const statusStr = statusEmoji ? ` ${statusEmoji}` : "";
				lines.push(box(bold(u.displayName) + planStr + statusStr));

				if (
					u.status?.indicator &&
					u.status.indicator !== "none" &&
					u.status.indicator !== "unknown" &&
					u.status.description
				) {
					const desc =
						u.status.description.length > 40 ? `${u.status.description.substring(0, 37)}…` : u.status.description;
					lines.push(box(t.fg("warning", `  ⚡ ${desc}`)));
				}

				if (u.error) {
					lines.push(box(dim(`  ${u.error}`)));
				} else if (u.windows.length === 0) {
					lines.push(box(dim("  No data")));
				} else {
					for (const w of u.windows) {
						const remaining = Math.max(0, 100 - w.usedPercent);
						const barW = 12;
						const filled = Math.min(barW, Math.round((w.usedPercent / 100) * barW));
						const empty = barW - filled;
						const color = remaining <= 10 ? "error" : remaining <= 30 ? "warning" : "success";
						const bar = t.fg(color, "█".repeat(filled)) + dim("░".repeat(empty));
						const reset = w.resetDescription ? dim(` ⏱ ${w.resetDescription}`) : "";
						lines.push(box(`  ${w.label.padEnd(7)} ${bar} ${remaining.toFixed(0).padStart(3)}%${reset}`));
					}
				}
				lines.push(box(""));
			}
		}

		const footerHint = this.view === "loading" ? dim("Esc close") : dim("r refresh · s settings · Esc close");

		lines.push(dim(`├${hLine}┤`));
		lines.push(box(footerHint));
		lines.push(dim(`╰${hLine}╯`));

		return lines;
	}
}
