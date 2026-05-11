import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { SteerChoice } from "./types";

// ── Component ──────────────────────────────────────────────────────────────────

export class SteerPromptComponent {
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private readonly message: string,
		private readonly theme: any,
		private readonly done: (choice: SteerChoice) => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, "s")) this.done("steer");
		else if (matchesKey(data, "q")) this.done("queue");
		else if (matchesKey(data, "d")) this.done("discard");
		else if (matchesKey(data, "e") || matchesKey(data, "escape")) this.done("edit");
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const th = this.theme;
		const maxMsgW = Math.max(10, width - 8);
		const preview = this.message.length > maxMsgW ? `${this.message.slice(0, maxMsgW - 1)}…` : this.message;

		const key = (k: string, label: string) => `${th.fg("accent", k)}${th.fg("dim", ` ${label}`)}`;

		const lines: string[] = [
			"",
			truncateToWidth(`  ${th.fg("muted", "↵")}  ${th.fg("dim", `"${preview}"`)}`, width),
			"",
			truncateToWidth(
				`  ${key("s", "steer")}   ${key("q", "queue")}   ${key("d", "discard")}   ${key("e", "edit")}`,
				width,
			),
			"",
		];

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}
