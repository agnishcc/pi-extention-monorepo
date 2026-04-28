export enum ChangeType {
	Created = "created",
	Edited = "edited",
	Deleted = "deleted",
}

export interface FileEntry {
	path: string; // absolute path
	relPath: string; // relative to cwd
	changeType: ChangeType;
}

export interface Colors {
	fgCreated: string;
	fgEdited: string;
	fgDeleted: string;
	fgHeader: string;
	fgMuted: string;
	fgDim: string;
	rst: string;
}

export interface WidgetConfig {
	maxLines: number;
	showHeader: boolean;
	includeDeleted: boolean;
	cwd: string;
}

/** Snapshot of git diff --name-status output */
export type GitDiffSnapshot = Map<string, ChangeType>;
