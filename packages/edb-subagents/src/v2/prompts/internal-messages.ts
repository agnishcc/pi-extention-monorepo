import type { MailboxMessage, QuestionRecord, RunRecord } from "../types.js";

export function childResultMessage(message: MailboxMessage, run: RunRecord): string {
	const outcome =
		run.state === "completed"
			? "completed — use get_subagent_result to retrieve the result"
			: `${run.state}: ${run.error?.message ?? "no result"}`;
	const transcript = run.result?.sessionFile ? ` · transcript: ${run.result.sessionFile}` : "";
	return `[${message.id}] Child ${run.agentId} run ${run.id} ${outcome}${transcript}`;
}

export function childQuestionMessage(message: MailboxMessage, question: QuestionRecord): string {
	return `[${message.id}] Child ${question.fromAgentId} asks (${question.id}): ${question.text}`;
}

export function parentAnswerMessage(messageId: string, question: QuestionRecord): string {
	return `[${messageId}] Parent answer for ${question.id}: ${question.answer ?? ""}`;
}
