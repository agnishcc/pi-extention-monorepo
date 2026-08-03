import type { AbortReason, RunControl, WaitLinkId } from "../types.js";

export function createRunControl(): RunControl {
	return { requestedYield: null, abortReason: null };
}

export function requestYield(
	control: RunControl,
	reason: "question" | "child_wait",
	entityId: string,
	abortReason?: AbortReason,
): void {
	control.requestedYield = { reason, entityId: entityId as WaitLinkId };
	control.abortReason = abortReason ?? null;
}
