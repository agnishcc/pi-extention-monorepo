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
}

export interface Answer {
	id: string;
	value: string;
	label: string;
	type: "text" | "choice";
	wasCustom: boolean;
	optionIndex?: number;
}

export interface AskResult {
	questions: AskQuestion[];
	answers: Answer[];
	cancelled: boolean;
}
