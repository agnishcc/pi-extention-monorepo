// ── Types ──────────────────────────────────────────────────────────────────────

export interface QuestionOption {
	value: string;
	label: string;
	description?: string;
	isOther?: boolean;
}

export type RenderOption = QuestionOption & { isOther?: boolean };

export interface AskQuestion {
	id: string;
	prompt: string;
	type: "text" | "choice";
	options?: QuestionOption[];
	placeholder?: string;
	label?: string;
	/** Allow the user to select multiple options (checkbox style). Only applies to choice questions. Default: false. */
	multiple?: boolean;
	/** Label for the auto-appended free-text option when no option is marked isOther. Defaults to "Type something." */
	customLabel?: string;
	/** Placeholder shown inside the inline editor for the free-text option in choice questions. */
	customPlaceholder?: string;
	/** Maximum number of option rows visible before scrolling kicks in. Default: 10. */
	maxVisibleOptions?: number;
}

export interface Answer {
	id: string;
	/** Primary selected value (first value for multiple-select). */
	value: string;
	/** All selected values — populated for multiple: true questions. */
	values?: string[];
	/** Primary display label. */
	label: string;
	/** All selected labels — populated for multiple: true questions. */
	labels?: string[];
	type: "text" | "choice";
	wasCustom: boolean;
	/** 1-based option index (single-select). */
	optionIndex?: number;
	/** 1-based option indices (multiple-select). */
	optionIndices?: number[];
}

export interface AskResult {
	questions: AskQuestion[];
	answers: Answer[];
	cancelled: boolean;
}
