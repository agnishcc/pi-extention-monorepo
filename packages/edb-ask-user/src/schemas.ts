import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

// ── Schemas ────────────────────────────────────────────────────────────────────

export const OptionSchema = Type.Object({
	value: Type.String({
		description: "Machine-readable value returned when this option is selected",
	}),
	label: Type.String({
		description: "Human-readable display label for the option",
	}),
	description: Type.Optional(
		Type.String({
			description: "Optional sub-label shown below the option (e.g. a clarifying note)",
		}),
	),
	isOther: Type.Optional(
		Type.Boolean({
			description:
				"Mark this option as the free-text option — opens an inline editor instead of returning a value. " +
				"Only one per question; if none, a default free-text option is auto-appended.",
		}),
	),
});

export const QuestionSchema = Type.Object({
	id: Type.String({
		description: "Unique key for this question — used to identify it in the returned answers map",
	}),
	prompt: Type.String({
		description: "The question text shown to the user",
	}),
	type: StringEnum(["text", "choice"] as const, {
		description:
			"text: user types a free-form answer via inline editor; " + "choice: user picks from a numbered option list",
	}),
	label: Type.Optional(
		Type.String({
			description: "Short label in the tab bar for multi-question flows (e.g. 'Scope'). Defaults to Q1, Q2, …",
		}),
	),
	options: Type.Optional(
		Type.Array(OptionSchema, {
			description: "Required when type is 'choice'. The options the user can choose from.",
		}),
	),
	placeholder: Type.Optional(
		Type.String({
			description: "Hint text inside the editor for text questions (e.g. 'Enter your API key…').",
		}),
	),
	multiple: Type.Optional(
		Type.Boolean({
			description: "Allow multi-select (checkbox style) on a choice question. Default: false.",
		}),
	),
	customLabel: Type.Optional(
		Type.String({
			description: "Label for the auto-appended free-text option row. Defaults to 'Type something.'",
		}),
	),
	customPlaceholder: Type.Optional(
		Type.String({
			description: "Placeholder inside the free-text editor in choice questions.",
		}),
	),
	maxVisibleOptions: Type.Optional(
		Type.Number({
			description: "Maximum number of option rows visible before scrolling kicks in. Default: 10.",
		}),
	),
});

export const AskUserParams = Type.Object({
	header: Type.Optional(
		Type.String({
			description: "Optional prompt title (e.g. 'Deployment settings').",
		}),
	),
	questions: Type.Array(QuestionSchema, {
		description: "Questions to ask. Single-item array = focused UI; multi-item = tabbed wizard with a Submit step.",
	}),
	overlay: Type.Optional(
		Type.Boolean({
			description:
				"Render as a framed popup overlay instead of inline — for prominent confirmations. Default: false.",
		}),
	),
});
