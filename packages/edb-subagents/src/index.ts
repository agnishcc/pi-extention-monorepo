/**
 * edb-subagents — v2 engine (v1 removed).
 *
 * The v1 engine (external broker sessions + edb-bridge) has been removed.
 * Sub-agents now always run in-process under a single deterministic
 * Coordinator; parent/child communication uses direct coordinator calls
 * and persisted mailboxes — no socket broker.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import subagentsV2Extension from "./v2/index.js";

export default function subagentsExtension(pi: ExtensionAPI): void {
	subagentsV2Extension(pi);
}
