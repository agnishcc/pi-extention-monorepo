import type { AgentId, MailboxMessage, MessageId } from "../types.js";

export class Mailbox {
	private messages = new Map<MessageId, MailboxMessage>();

	constructor(messages: MailboxMessage[] = []) {
		for (const message of messages) this.messages.set(message.id, structuredClone(message));
	}

	push(message: MailboxMessage): boolean {
		if (this.messages.has(message.id)) return false;
		this.messages.set(message.id, message);
		return true;
	}

	pending(recipientAgentId: AgentId): MailboxMessage[] {
		return [...this.messages.values()]
			.filter((message) => message.recipientAgentId === recipientAgentId && message.state === "pending")
			.sort((left, right) => left.priority - right.priority || left.createdAt.localeCompare(right.createdAt));
	}

	update(id: MessageId, patch: Partial<MailboxMessage>): MailboxMessage {
		const current = this.messages.get(id);
		if (!current) throw new Error(`Mailbox message ${id} not found`);
		const next = { ...current, ...patch };
		this.messages.set(id, next);
		return next;
	}

	all(): MailboxMessage[] {
		return [...this.messages.values()];
	}

	prune(maxConsumed = 500): void {
		const consumed = this.all()
			.filter((message) => message.state === "consumed")
			.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
		for (const message of consumed.slice(maxConsumed)) this.messages.delete(message.id);
	}
}
