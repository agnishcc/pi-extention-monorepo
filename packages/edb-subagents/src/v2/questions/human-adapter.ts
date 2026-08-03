import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export class HumanAdapter {
	private context: ExtensionContext | undefined;

	setContext(context: ExtensionContext): void {
		this.context = context;
	}

	async ask(input: {
		originatingAgent: string;
		hierarchyPath: string;
		taskId?: string;
		questionId: string;
		question: string;
		context?: string;
	}): Promise<{ status: "answered"; answer: string } | { status: "human_required" }> {
		const ctx = this.context;
		if (!ctx?.hasUI) return { status: "human_required" };
		const label = [
			`Question ${input.questionId} from ${input.originatingAgent}`,
			`Path: ${input.hierarchyPath}`,
			input.taskId ? `Task: ${input.taskId}` : "",
			input.context ?? "",
			input.question,
		]
			.filter(Boolean)
			.join("\n");
		const answer = await ctx.ui.input(label);
		return answer ? { status: "answered", answer } : { status: "human_required" };
	}
}
