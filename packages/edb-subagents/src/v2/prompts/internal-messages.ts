import type { MailboxMessage, QuestionRecord, RunRecord } from "../types.js";

export function childResultMessage(message: MailboxMessage, run: RunRecord): string {
	return `[${message.id}] Child ${run.agentId} run ${run.id} ${run.state}: ${run.result?.text ?? run.error?.message ?? "no result"}`;
}

export function childQuestionMessage(message: MailboxMessage, question: QuestionRecord): string {
	return `[${message.id}] Child ${question.fromAgentId} asks (${question.id}): ${question.text}`;
}

export function parentAnswerMessage(messageId: string, question: QuestionRecord): string {
	return `[${messageId}] Parent answer for ${question.id}: ${question.answer ?? ""}`;
}
