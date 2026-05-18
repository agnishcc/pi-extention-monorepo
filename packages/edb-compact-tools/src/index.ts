import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { installGenericToolRendererPatch, installMessageRenderers, registerDelegatingTool } from "./patches.js";
import type { BuiltinTool } from "./types.js";

export default function compactTools(pi: ExtensionAPI): void {
	installGenericToolRendererPatch(pi);
	installMessageRenderers(pi);
	registerDelegatingTool(pi, "read", createReadTool as unknown as (cwd: string) => BuiltinTool);
	registerDelegatingTool(pi, "bash", createBashTool as unknown as (cwd: string) => BuiltinTool);
	registerDelegatingTool(pi, "grep", createGrepTool as unknown as (cwd: string) => BuiltinTool);
	registerDelegatingTool(pi, "find", createFindTool as unknown as (cwd: string) => BuiltinTool);
	registerDelegatingTool(pi, "ls", createLsTool as unknown as (cwd: string) => BuiltinTool);
	registerDelegatingTool(pi, "edit", createEditTool as unknown as (cwd: string) => BuiltinTool);
	registerDelegatingTool(pi, "write", createWriteTool as unknown as (cwd: string) => BuiltinTool);
}
