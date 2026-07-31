import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export class RootAdapter {
	constructor(private readonly pi: ExtensionAPI) {}

	deliver(content: string, details: Record<string, unknown>, triggerTurn: boolean): void {
		this.pi.sendMessage(
			{ customType: "edb-subagents-v2", content, display: true, details },
			{ triggerTurn, deliverAs: "followUp" },
		);
	}
}
