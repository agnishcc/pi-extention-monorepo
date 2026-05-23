import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { CompactTheme, ToolBlockKind } from "./types.js";

export class EmptyBlock {
	render(): string[] {
		return [];
	}
	invalidate(): void {}
}

export interface BranchToolBlockOptions {
	pending?: boolean;
	shimmerText?: string;
}

export class BranchToolBlock {
	constructor(
		private readonly kind: ToolBlockKind,
		private readonly lines: string[],
		private readonly theme: CompactTheme,
		private readonly colorFn: (text: string) => string,
		private readonly options: BranchToolBlockOptions = {},
	) {}

	render(width: number): string[] {
		const renderWidth = Math.max(8, width - 1);
		const lines = this.lines.length > 0 ? this.lines : [""];
		const block = lines.map((line, index) => {
			if (this.kind === "call" || index === 0) return this.renderTop(line, renderWidth);
			const isLast = index === lines.length - 1;
			return isLast ? this.renderBottom(line, renderWidth) : this.renderBody(line, renderWidth);
		});
		const spacerLine = " ".repeat(renderWidth);
		const ruleLine = this.theme.fg("borderMuted", "─".repeat(renderWidth));
		return [spacerLine, ruleLine, ...block, ruleLine, spacerLine];
	}

	invalidate(): void {}

	private color(text: string): string {
		return this.colorFn(text);
	}

	private pendingColor(): string {
		const colors = ["warning", "accent", "muted"] as const;
		return colors[Math.floor(Date.now() / 180) % colors.length];
	}

	private fit(text: string, width: number): string {
		const clipped = truncateToWidth(text, Math.max(1, width), "");
		return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
	}

	private renderTop(content: string, width: number): string {
		const isPending = this.options.pending;
		const shimmerText = this.options.shimmerText;
		const activeColor = isPending ? this.pendingColor() : undefined;

		const prefix = activeColor ? this.theme.fg(activeColor, "● ") : this.color("● ");

		let bodyContent: string;
		if (shimmerText) {
			const coloredName = activeColor
				? this.theme.fg(activeColor, this.theme.bold(shimmerText))
				: this.color(this.theme.bold(shimmerText));
			bodyContent = `${coloredName} ${content}`;
		} else {
			bodyContent = content;
		}

		const contentWidth = Math.max(1, width - visibleWidth("● "));
		return `${prefix}${this.fit(bodyContent, contentWidth)}`;
	}

	private renderBody(content: string, width: number): string {
		const prefix = this.theme.fg("borderMuted", "├─ ");
		const contentWidth = Math.max(1, width - visibleWidth("├─ "));
		return `${prefix}${this.fit(content, contentWidth)}`;
	}

	private renderBottom(content: string, width: number): string {
		const prefix = this.color("└─ ");
		const contentWidth = Math.max(1, width - visibleWidth("└─ "));
		return `${prefix}${this.fit(content, contentWidth)}`;
	}
}
