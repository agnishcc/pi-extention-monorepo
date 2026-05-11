import { complete } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { extractUserText, sanitizeSessionName, shouldArmAutoNaming } from "./title";

const MODEL_PROVIDER = "opencode";
const MODEL_ID = "big-pickle";

const SYSTEM_PROMPT = `You create short session titles for coding and technical work.
Return exactly one title based only on the user's first message.
Rules:
- Prefer 2 to 6 words
- Use Title Case
- Mention the task, feature, bug, or file focus when clear
- No quotes
- No markdown
- No labels like Title:
- No trailing punctuation
- Maximum 60 characters`;

export default function autoNameSessionExtension(pi: ExtensionAPI): void {
	let sessionToken = 0;
	let armed = false;
	let pending = false;

	pi.on("session_start", async (_event, ctx) => {
		sessionToken += 1;
		armed = shouldArmAutoNaming(ctx.sessionManager.getBranch(), pi.getSessionName());
		pending = false;
	});

	pi.on("session_shutdown", async () => {
		sessionToken += 1;
		armed = false;
		pending = false;
	});

	pi.on("before_agent_start", async (event) => {
		const name = pi.getSessionName();
		if (!name) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\nCurrent session name: ${name}`,
		};
	});

	pi.on("message_end", async (event, ctx) => {
		if (!armed || pending || pi.getSessionName()) return;
		if (event.message.role !== "user") return;

		const prompt = extractUserText(event.message.content);
		armed = false;
		if (!prompt) return;

		pending = true;
		const token = sessionToken;

		if (ctx.hasUI) {
			ctx.ui.notify("Auto-naming session…", "info");
		}

		try {
			const name = await generateSessionName(prompt, ctx);
			if (!name) return;
			if (token !== sessionToken) return;
			if (pi.getSessionName()) return;
			pi.setSessionName(name);
			if (ctx.hasUI) {
				ctx.ui.notify(`Session named: ${name}`, "info");
			}
		} catch (error: unknown) {
			console.error("[edb-auto-name-session] Failed to generate session name:", error);
		} finally {
			if (token === sessionToken) pending = false;
		}
	});
}

async function generateSessionName(prompt: string, ctx: ExtensionContext): Promise<string | undefined> {
	const model = ctx.modelRegistry.find(MODEL_PROVIDER, MODEL_ID);
	if (!model) return undefined;

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) return undefined;

	const response = await complete(
		model,
		{
			systemPrompt: SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: prompt }],
					timestamp: Date.now(),
				},
			],
		},
		{
			apiKey: auth.apiKey,
			headers: auth.headers,
			maxTokens: 256,
		},
	);

	const text = response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();

	return sanitizeSessionName(text);
}
