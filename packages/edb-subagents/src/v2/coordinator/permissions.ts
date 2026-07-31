import { PermissionDeniedError } from "../errors.js";
import type { AgentId } from "../types.js";
import type { AgentRegistry } from "./agent-registry.js";

export function isDescendant(registry: AgentRegistry, ancestorId: AgentId, candidateId: AgentId): boolean {
	let candidate = registry.getAgent(candidateId);
	while (candidate.parentAgentId) {
		if (candidate.parentAgentId === ancestorId) return true;
		candidate = registry.getAgent(candidate.parentAgentId);
	}
	return false;
}

export function assertCanManage(
	registry: AgentRegistry,
	callerId: AgentId,
	targetId: AgentId,
	directOnly = false,
): void {
	if (callerId === "root") {
		if (targetId === "root") throw new PermissionDeniedError("Root cannot manage itself through child tools");
		return;
	}
	const target = registry.getAgent(targetId);
	const allowed = directOnly ? target.parentAgentId === callerId : isDescendant(registry, callerId, targetId);
	if (!allowed) throw new PermissionDeniedError(`${callerId} cannot manage ${targetId}`);
}

export function assertDirectParent(registry: AgentRegistry, callerId: AgentId, childId: AgentId): void {
	if (registry.getAgent(childId).parentAgentId !== callerId) {
		throw new PermissionDeniedError(`Only the direct parent may answer ${childId}`);
	}
}
