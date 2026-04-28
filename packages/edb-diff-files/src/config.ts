import { existsSync, readFileSync } from "node:fs";
import type { Colors, WidgetConfig } from "./types";

// ---------------------------------------------------------------------------
// Widget config — env → settings.json → defaults
// ---------------------------------------------------------------------------

const DEFAULTS: WidgetConfig = {
	maxLines: 8,
	showHeader: true,
	includeDeleted: false,
	cwd: process.cwd(),
};

function envInt(name: string, fallback: number): number {
	const v = Number.parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(v) && v > 0 ? v : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
	const v = process.env[name]?.toLowerCase();
	if (v === "true" || v === "1") return true;
	if (v === "false" || v === "0") return false;
	return fallback;
}

export function loadConfig(): WidgetConfig {
	let maxLines = envInt("FILES_WIDGET_MAX_LINES", DEFAULTS.maxLines);
	let showHeader = envBool("FILES_WIDGET_SHOW_HEADER", DEFAULTS.showHeader);
	let includeDeleted = envBool("FILES_WIDGET_INCLUDE_DELETED", DEFAULTS.includeDeleted);

	const paths = [`${process.cwd()}/.pi/settings.json`, `${process.env.HOME ?? ""}/.pi/settings.json`];
	for (const p of paths) {
		try {
			if (existsSync(p)) {
				const raw = JSON.parse(readFileSync(p, "utf-8"));
				if (raw.filesWidgetMaxLines != null) maxLines = raw.filesWidgetMaxLines;
				if (raw.filesWidgetShowHeader != null) showHeader = raw.filesWidgetShowHeader;
				if (raw.filesWidgetIncludeDeleted != null) includeDeleted = raw.filesWidgetIncludeDeleted;
			}
		} catch {
			/* skip invalid */
		}
	}

	return { maxLines, showHeader, includeDeleted, cwd: process.cwd() };
}

// ---------------------------------------------------------------------------
// Colors — theme → fallbacks
// ---------------------------------------------------------------------------

const FG_GREEN = "\x1b[38;2;100;180;120m";
const FG_YELLOW = "\x1b[38;2;200;180;80m";
const FG_RED = "\x1b[38;2;200;100;100m";
const FG_MUTED = "\x1b[38;2;139;148;158m";
const FG_DIM = "\x1b[38;2;80;80;80m";
const RST = "\x1b[0m";

export function resolveColors(theme?: any): Colors {
	let fgCreated = FG_GREEN;
	let fgEdited = FG_YELLOW;
	let fgDeleted = FG_RED;
	let fgHeader = FG_MUTED;
	let fgMuted = FG_MUTED;
	let fgDim = FG_DIM;

	if (theme?.getFgAnsi) {
		try {
			fgCreated = theme.getFgAnsi("toolDiffAdded") || FG_GREEN;
			fgEdited = theme.getFgAnsi("warning") || theme.getFgAnsi("accent") || FG_YELLOW;
			fgDeleted = theme.getFgAnsi("toolDiffRemoved") || FG_RED;
			fgHeader = theme.getFgAnsi("muted") || FG_MUTED;
			fgMuted = theme.getFgAnsi("muted") || FG_MUTED;
			fgDim = theme.getFgAnsi("dim") || FG_DIM;
		} catch {
			/* use fallbacks */
		}
	}

	return { fgCreated, fgEdited, fgDeleted, fgHeader, fgMuted, fgDim, rst: RST };
}
