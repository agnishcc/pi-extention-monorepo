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
				"Mark this option as a free-text option. When selected, opens an inline editor " +
				"instead of returning the option value. Use this when you want to provide your own " +
				"label for the free-text option (e.g. 'Other', 'Custom'). " +
				"If no option is marked isOther, a default 'Type something.' option is auto-appended. " +
				"Only one option should be marked isOther per question.",
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
			description:
				"Short label shown in the tab bar when multiple questions are asked " +
				"(e.g. 'Scope', 'Priority'). Defaults to Q1, Q2, …",
		}),
	),
	options: Type.Optional(
		Type.Array(OptionSchema, {
			description: "Required when type is 'choice'. The options the user can choose from.",
		}),
	),
	placeholder: Type.Optional(
		Type.String({
			description:
				"Hint text shown inside the editor for text questions " +
				"(e.g. 'Enter your API key…'). Purely informational.",
		}),
	),
});

export const AskUserParams = Type.Object({
	questions: Type.Array(QuestionSchema, {
		description:
			"One or more questions to ask the user. " +
			"Single-item arrays show a focused UI. " +
			"Multi-item arrays show a tabbed wizard with a Submit step.",
	}),
});
