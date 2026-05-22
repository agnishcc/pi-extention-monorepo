import {
	AssistantMessageComponent,
	type ExtensionAPI,
	ToolExecutionComponent,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { Markdown } from "@earendil-works/pi-tui";
import {
	ASSISTANT_MESSAGE_PATCH_SYMBOL,
	TOOL_EXECUTION_PATCH_SYMBOL,
	USER_MESSAGE_MARKER_SYMBOL,
	USER_MESSAGE_PATCH_SYMBOL,
} from "./constants.js";
import { DottedParagraph, frameUserMessage, randomUserMessageMarker, ThinkingParagraph } from "./message-frame.js";
import { renderCall, renderResult } from "./tool-renderer.js";
import type { BuiltinTool, BuiltinToolName, CompactTheme } from "./types.js";

// ── Shared state ─────────────────────────────────────────────────

let activeTheme: CompactTheme | undefined;

function fallbackTheme(): CompactTheme {
	return {
		fg: (_color: any, text: string) => text,
		bg: (_color: any, text: string) => text,
		bold: (text: string) => text,
	};
}

// ── Generic tool renderer patch ──────────────────────────────────

export function installGenericToolRendererPatch(pi: ExtensionAPI): void {
	const proto = ToolExecutionComponent?.prototype as any;
	if (!proto || proto[TOOL_EXECUTION_PATCH_SYMBOL]) return;
	const originalGetCallRenderer = proto.getCallRenderer;
	const originalGetResultRenderer = proto.getResultRenderer;
	const originalGetRenderShell = proto.getRenderShell;
	if (
		typeof originalGetCallRenderer !== "function" ||
		typeof originalGetResultRenderer !== "function" ||
		typeof originalGetRenderShell !== "function"
	) {
		return;
	}

	proto.getCallRenderer = function compactFallbackCallRenderer(this: any) {
		const toolName = typeof this?.toolName === "string" ? this.toolName : "tool";
		return (args: any, theme: CompactTheme, context: any) => renderCall(toolName, args, theme, context);
	};

	proto.getResultRenderer = function compactFallbackResultRenderer(this: any) {
		const toolName = typeof this?.toolName === "string" ? this.toolName : "tool";
		return (result: any, options: any, theme: CompactTheme, context: any) =>
			renderResult(toolName, result, options, theme, context);
	};

	proto.getRenderShell = function compactFallbackRenderShell(this: any) {
		return "self";
	};

	proto[TOOL_EXECUTION_PATCH_SYMBOL] = { originalGetCallRenderer, originalGetResultRenderer, originalGetRenderShell };
	pi.on("session_shutdown", () => {
		const state = proto[TOOL_EXECUTION_PATCH_SYMBOL];
		if (!state) return;
		proto.getCallRenderer = state.originalGetCallRenderer;
		proto.getResultRenderer = state.originalGetResultRenderer;
		proto.getRenderShell = state.originalGetRenderShell;
		delete proto[TOOL_EXECUTION_PATCH_SYMBOL];
	});
}

// ── Message renderer patches ─────────────────────────────────────

export function installMessageRenderers(pi: ExtensionAPI): void {
	const userProto = UserMessageComponent?.prototype as any;
	if (userProto && !userProto[USER_MESSAGE_PATCH_SYMBOL] && typeof userProto.render === "function") {
		const originalRender = userProto.render as (width: number) => string[];
		userProto.render = function compactUserMessageRender(this: any, width: number): string[] {
			const box = this?.contentBox;
			if (box) {
				box.paddingY = 0;
				box.setBgFn?.(undefined);
				box.invalidate?.();
			}
			const frameWidth = Math.max(1, width - 1);
			if (!this[USER_MESSAGE_MARKER_SYMBOL]) this[USER_MESSAGE_MARKER_SYMBOL] = randomUserMessageMarker();
			const rendered = originalRender.call(this, Math.max(1, frameWidth - 2));
			return frameUserMessage(
				rendered,
				frameWidth,
				activeTheme ?? fallbackTheme(),
				this[USER_MESSAGE_MARKER_SYMBOL],
			);
		};
		userProto[USER_MESSAGE_PATCH_SYMBOL] = { originalRender };
	}

	const assistantProto = AssistantMessageComponent?.prototype as any;
	if (
		assistantProto &&
		!assistantProto[ASSISTANT_MESSAGE_PATCH_SYMBOL] &&
		typeof assistantProto.updateContent === "function"
	) {
		const originalUpdateContent = assistantProto.updateContent;
		assistantProto.updateContent = function compactAssistantUpdateContent(this: any, message: any): void {
			originalUpdateContent.call(this, message);
			const container = this?.contentContainer;
			if (!container?.children) return;
			const markdownTheme = this?.markdownTheme;
			for (let i = container.children.length - 1; i >= 0; i--) {
				const child = container.children[i];
				if (!(child instanceof Markdown)) continue;
				const markdownChild = child as any;
				const text = markdownChild.text;
				if (typeof text !== "string" || text.length === 0) continue;
				const isThinking = Boolean(markdownChild.defaultTextStyle?.italic);
				container.children[i] = isThinking
					? new ThinkingParagraph(text, markdownTheme, markdownChild.defaultTextStyle)
					: new DottedParagraph(text, markdownTheme);
			}
		};
		assistantProto[ASSISTANT_MESSAGE_PATCH_SYMBOL] = { originalUpdateContent };
	}

	pi.on("session_start", (_event, ctx) => {
		if (ctx.hasUI) activeTheme = ctx.ui.theme as unknown as CompactTheme;
	});
	pi.on("session_shutdown", () => {
		const userState = userProto?.[USER_MESSAGE_PATCH_SYMBOL];
		if (userState) {
			userProto.render = userState.originalRender;
			delete userProto[USER_MESSAGE_PATCH_SYMBOL];
		}
		const assistantState = assistantProto?.[ASSISTANT_MESSAGE_PATCH_SYMBOL];
		if (assistantState) {
			assistantProto.updateContent = assistantState.originalUpdateContent;
			delete assistantProto[ASSISTANT_MESSAGE_PATCH_SYMBOL];
		}
		activeTheme = undefined;
	});
}

// ── Delegating tool registration ─────────────────────────────────

export function registerDelegatingTool(
	pi: ExtensionAPI,
	name: BuiltinToolName,
	createTool: (cwd: string) => BuiltinTool,
): void {
	const cwd = process.cwd();
	const original = createTool(cwd);
	pi.registerTool({
		name,
		label: name,
		description: original.description,
		promptSnippet: (original as any).promptSnippet,
		promptGuidelines: (original as any).promptGuidelines,
		parameters: original.parameters as any,
		renderShell: "self",
		async execute(id: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown, ctx?: any) {
			return createTool(ctx?.cwd ?? cwd).execute(id, params, signal, onUpdate, ctx) as any;
		},
		renderCall(args: any, theme: CompactTheme, context: any) {
			return renderCall(name, args, theme, context);
		},
		renderResult(result: any, options: any, theme: CompactTheme, context: any) {
			return renderResult(name, result, options, theme, context);
		},
	} as any);
}
