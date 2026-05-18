import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CompactTheme, ToolBlockKind } from "./types.js";

export class EmptyBlock {
	render(): string[] {
		return [];
	}
	invalidate(): void {}
}

export class ToolBlock {
	constructor(
		private readonly kind: ToolBlockKind,
		private readonly lines: string[],
		private readonly theme: CompactTheme,
		private readonly colorFn: (text: string) => string,
	) {}

	render(width: number): string[] {
		const renderWidth = Math.max(8, width - 1);
		const separator = this.theme.fg("borderMuted", "─".repeat(Math.max(8, Math.min(32, renderWidth))));
		const block = this.lines.map((line, index) => {
			if (this.kind === "call") return this.renderTop(line, renderWidth);
			if (this.kind === "full" && index === 0) return this.renderTop(line, renderWidth);
			const isLast = index === this.lines.length - 1;
			return isLast ? this.renderBottom(line, renderWidth) : this.renderBody(line, renderWidth);
		});
		return [separator, "", ...block, ""];
	}

	invalidate(): void {}

	private color(text: string): string {
		return this.colorFn(text);
	}

	private fit(text: string, width: number): string {
		const clipped = truncateToWidth(text, Math.max(1, width), "");
		return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
	}

	private renderTop(content: string, width: number): string {
		const prefix = this.color("╭─ ");
		const suffix = this.color("╮");
		const innerWidth = Math.max(1, width - 4);
		const fitted = truncateToWidth(content, innerWidth, "");
		const fill = this.color("─".repeat(Math.max(0, innerWidth - visibleWidth(fitted))));
		return `${prefix}${fitted}${fill}${suffix}`;
	}

	private renderBody(content: string, width: number): string {
		const innerWidth = Math.max(1, width - 2);
		return `${this.color("│")}${this.fit(content, innerWidth)}${this.color("│")}`;
	}

	private renderBottom(content: string, width: number): string {
		const prefix = this.color("╰─ ");
		const suffix = this.color("╯");
		const innerWidth = Math.max(1, width - 4);
		const fitted = truncateToWidth(content, innerWidth, "");
		const fill = this.color("─".repeat(Math.max(0, innerWidth - visibleWidth(fitted))));
		return `${prefix}${fitted}${fill}${suffix}`;
	}
}
