import { ChangeType, type Colors, type FileEntry, type WidgetConfig } from "./types";

/**
 * Render file entries into widget lines.
 *
 * Format:
 *   N files changed
 *   + src/new-file.ts
 *   ~ src/existing.ts
 *   - src/removed.ts
 *   … 3 more
 */
export function renderWidget(entries: ReadonlyArray<FileEntry>, colors: Colors, config: WidgetConfig): string[] {
	if (entries.length === 0) return [];

	// Filter deleted if not included
	const visible = config.includeDeleted ? entries : entries.filter((e) => e.changeType !== ChangeType.Deleted);

	if (visible.length === 0) return [];

	const lines: string[] = [];

	if (config.showHeader) {
		const label = visible.length === 1 ? "1 file changed" : `${visible.length} files changed`;
		lines.push(`${colors.fgHeader}${label}${colors.rst}`);
	}

	const shown = visible.slice(0, config.maxLines);
	for (const entry of shown) {
		let prefix: string;
		switch (entry.changeType) {
			case ChangeType.Created:
				prefix = `${colors.fgCreated}+${colors.rst}`;
				break;
			case ChangeType.Edited:
				prefix = `${colors.fgEdited}~${colors.rst}`;
				break;
			case ChangeType.Deleted:
				prefix = `${colors.fgDeleted}-${colors.rst}`;
				break;
		}
		lines.push(` ${prefix} ${colors.fgDim}${entry.relPath}${colors.rst}`);
	}

	const remaining = visible.length - config.maxLines;
	if (remaining > 0) {
		lines.push(`${colors.fgMuted}  … ${remaining} more${colors.rst}`);
	}

	return lines;
}
