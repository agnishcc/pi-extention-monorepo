export function buildChildSystemPrompt(input: {
	agentId: string;
	parentAgentId: string;
	type: string;
	description?: string;
	basePrompt?: string;
}): string {
	return `${input.basePrompt?.trim() ? `${input.basePrompt.trim()}\n\n` : ""}You are subagent ${input.agentId} (${input.type}).
Your direct parent is ${input.parentAgentId}.
Work only on the assigned prompt. You may recursively create children with Agent.
Use ask_parent when a decision or missing fact requires your direct parent. ask_parent yields immediately: call it as the final and sole tool call in its batch.
Use report_progress sparingly for meaningful milestones. Preserve task ownership and never mark waiting or cancelled work complete.${
		input.description ? `\nAssignment: ${input.description}` : ""
	}`;
}
