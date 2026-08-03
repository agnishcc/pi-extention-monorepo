import { EntityNotFoundError } from "../errors.js";
import type { RunId, WaitLink, WaitLinkId } from "../types.js";

export class WaitLinks {
	private links = new Map<WaitLinkId, WaitLink>();

	constructor(links: WaitLink[] = []) {
		for (const link of links) this.links.set(link.id, structuredClone(link));
	}

	add(link: WaitLink): void {
		this.links.set(link.id, link);
	}

	get(id: WaitLinkId): WaitLink {
		const link = this.links.get(id);
		if (!link) throw new EntityNotFoundError("WaitLink", id);
		return link;
	}

	forChildRun(runId: RunId): WaitLink[] {
		return [...this.links.values()].filter(
			(link) => link.childRunId === runId && (link.state === "waiting" || link.state === "question_delivered"),
		);
	}

	update(id: WaitLinkId, patch: Partial<WaitLink>): WaitLink {
		const current = this.get(id);
		const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
		this.links.set(id, next);
		return next;
	}

	all(): WaitLink[] {
		return [...this.links.values()];
	}
}
