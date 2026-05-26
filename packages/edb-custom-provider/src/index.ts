/**
 * pi-custom-provider
 *
 * Registers custom model providers for pi.
 * Each provider is a separate file in this directory.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerCrofAiProvider } from "./providers/crofai";

export default function customProviderExtension(pi: ExtensionAPI): void {
	registerCrofAiProvider(pi);
}
