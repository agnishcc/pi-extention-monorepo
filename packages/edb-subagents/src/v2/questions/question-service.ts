import type { AgentRegistry } from "../coordinator/agent-registry.js";
import { createId } from "../coordinator/agent-registry.js";
import { EntityNotFoundError, PermissionDeniedError } from "../errors.js";
import type { AskParentInput, CallerContext, QuestionId, QuestionRecord } from "../types.js";

export class QuestionService {
	readonly questions = new Map<QuestionId, QuestionRecord>();

	constructor(
		private registry: AgentRegistry,
		records: QuestionRecord[] = [],
	) {
		for (const record of records) this.questions.set(record.id, structuredClone(record));
	}

	setRegistry(registry: AgentRegistry): void {
		this.registry = registry;
	}

	create(caller: CallerContext, input: AskParentInput): QuestionRecord {
		if (!caller.runId) throw new Error("A child question requires an active run");
		const agent = this.registry.getAgent(caller.agentId);
		if (!agent.parentAgentId) throw new PermissionDeniedError("Root questions are handled by the human adapter");
		if (input.for_question_id) {
			const linked = this.get(input.for_question_id);
			if (linked.toAgentId !== caller.agentId) {
				throw new PermissionDeniedError(`${caller.agentId} cannot escalate ${linked.id}`);
			}
			if (linked.state !== "open" && linked.state !== "escalated") {
				throw new Error(`Question ${linked.id} is ${linked.state}`);
			}
		}
		const now = new Date().toISOString();
		const record: QuestionRecord = {
			id: createId("qst"),
			fromAgentId: caller.agentId,
			fromRunId: caller.runId,
			toAgentId: agent.parentAgentId,
			linkedQuestionId: input.for_question_id ?? null,
			taskId: input.task_id ?? this.registry.getRun(caller.runId).taskId,
			state: input.for_question_id ? "escalated" : "open",
			text: input.question,
			answer: null,
			createdAt: now,
			answeredAt: null,
			expiresAt: input.timeout_ms ? new Date(Date.now() + input.timeout_ms).toISOString() : null,
		};
		this.questions.set(record.id, record);
		return record;
	}

	get(id: QuestionId): QuestionRecord {
		const question = this.questions.get(id);
		if (!question) throw new EntityNotFoundError("Question", id);
		return question;
	}

	answer(caller: CallerContext, questionId: QuestionId, answer: string): QuestionRecord {
		const question = this.get(questionId);
		if (question.toAgentId !== caller.agentId)
			throw new PermissionDeniedError(`${caller.agentId} cannot answer ${questionId}`);
		if (question.state !== "open" && question.state !== "escalated")
			throw new Error(`Question ${questionId} is ${question.state}`);
		if (question.expiresAt && Date.parse(question.expiresAt) <= Date.now()) {
			throw new Error(`Question ${questionId} has expired`);
		}
		question.state = "answered";
		question.answer = answer;
		question.answeredAt = new Date().toISOString();
		return question;
	}

	all(): QuestionRecord[] {
		return [...this.questions.values()];
	}
}
