/**
 * prompts.ts — System prompt builder for agents.
 */

import type { AgentConfig, EnvInfo } from "./types.js";

/** Extra sections to inject into the system prompt (memory, skills, etc.). */
export interface PromptExtras {
	/** Persistent memory content to inject (first 200 lines of MEMORY.md + instructions). */
	memoryBlock?: string;
	/** Preloaded skill contents to inject. */
	skillBlocks?: { name: string; content: string }[];
	/**
	 * edb-bridge context for sub-agent communication.
	 * Injected as XML tags so sub-agent's edb-bridge and edb-todo extensions can read it.
	 */
	bridgeContext?: {
		parentSessionId: string; // broker session ID of the parent
		agentId: string; // edb-subagents agent ID
		storePath?: string; // parent's edb-todo task store file path
		taskId?: string; // assigned task ID for this agent
		agentIsSubtask?: boolean; // true = already a subtask (depth 1) — no further subtasks allowed
	};
}

/**
 * Build the system prompt for an agent from its config.
 *
 * - "replace" mode: env header + config.systemPrompt (full control, no parent identity)
 * - "append" mode: env header + parent system prompt + sub-agent context + config.systemPrompt
 * - "append" with empty systemPrompt: pure parent clone
 *
 * Both modes prepend an `<active_agent name="${config.name}"/>` tag so downstream
 * extensions (e.g. permission/policy systems) can resolve per-agent policy
 * inside the child session by parsing the system prompt.
 *
 * @param parentSystemPrompt  The parent agent's effective system prompt (for append mode).
 * @param extras  Optional extra sections to inject (memory, preloaded skills).
 */
export function buildAgentPrompt(
	config: AgentConfig,
	cwd: string,
	env: EnvInfo,
	parentSystemPrompt?: string,
	extras?: PromptExtras,
): string {
	const activeAgentTag = `<active_agent name="${config.name}"/>\n\n`;

	const envBlock = `# Environment
Working directory: ${cwd}
${env.isGitRepo ? `Git repository: yes\nBranch: ${env.branch}` : "Not a git repository"}
Platform: ${env.platform}`;

	// Build optional extras suffix
	const extraSections: string[] = [];
	if (extras?.memoryBlock) {
		extraSections.push(extras.memoryBlock);
	}
	if (extras?.skillBlocks?.length) {
		for (const skill of extras.skillBlocks) {
			extraSections.push(`\n# Preloaded Skill: ${skill.name}\n${skill.content}`);
		}
	}
	// edb-bridge context: inject XML tags so sub-agent extensions can read parent session info
	if (extras?.bridgeContext) {
		const { parentSessionId, agentId, storePath, taskId, agentIsSubtask } = extras.bridgeContext;
		const storeTag = storePath ? `\n<task_store_path>${storePath}</task_store_path>` : "";
		const taskTag = taskId ? `\n<assigned_task_id>${taskId}</assigned_task_id>` : "";
		extraSections.push(
			`<bridge_context>\n<bridge_parent_session>${parentSessionId}</bridge_parent_session>\n<bridge_agent_id>${agentId}</bridge_agent_id>${storeTag}${taskTag}\n</bridge_context>`,
		);
		// Task context instructions — only when task_id was provided
		if (taskId) {
			extraSections.push(buildTaskContextBlock(taskId, agentId, agentIsSubtask ?? false));
		}
	}
	const extrasSuffix = extraSections.length > 0 ? `\n\n${extraSections.join("\n")}` : "";

	if (config.promptMode === "append") {
		const identity = parentSystemPrompt || genericBase;

		const bridge = `<sub_agent_context>
You are operating as a sub-agent invoked to handle a specific task.
- Use the read tool instead of cat/head/tail
- Use the edit tool instead of sed/awk
- Use the write tool instead of echo/heredoc
- Use the find tool instead of bash find/ls for file search
- Use the grep tool instead of bash grep/rg for content search
- Make independent tool calls in parallel
- Use absolute file paths
- Do not use emojis
- Be concise but complete
</sub_agent_context>`;

		const customSection = config.systemPrompt?.trim()
			? `\n\n<agent_instructions>\n${config.systemPrompt}\n</agent_instructions>`
			: "";

		return (
			activeAgentTag +
			envBlock +
			"\n\n<inherited_system_prompt>\n" +
			identity +
			"\n</inherited_system_prompt>\n\n" +
			bridge +
			customSection +
			extrasSuffix
		);
	}

	// "replace" mode — env header + the config's full system prompt
	const replaceHeader = `You are a pi coding agent sub-agent.
You have been invoked to handle a specific task autonomously.

${envBlock}`;

	return `${activeAgentTag + replaceHeader}\n\n${config.systemPrompt}${extrasSuffix}`;
}

/** Fallback base prompt when parent system prompt is unavailable in append mode. */
const genericBase = `# Role
You are a general-purpose coding agent for complex, multi-step tasks.
You have full access to read, write, edit files, and execute commands.
Do what has been asked; nothing more, nothing less.`;

/**
 * Build the task context block injected when a task_id is assigned at spawn time.
 *
 * Tells the sub-agent:
 * - Its assigned task ID and how to update it
 * - Whether it can create subtasks (depth-0 task: yes; depth-1 subtask: no)
 * - That depth-1 agents must not create further subtasks (two-layer rule)
 */
function buildTaskContextBlock(taskId: string, agentId: string, agentIsSubtask: boolean): string {
	const subtaskSection = agentIsSubtask
		? `**Subtasks:** You are already a subtask (${taskId}). Do NOT create further subtasks (parentId is not allowed). You are at the maximum nesting depth. If you need internal tracking, you may use TaskCreate without parentId — those tasks will not appear in the orchestrator's widget.`
		: `**Subtasks (optional):** You may break your work into subtasks visible to the orchestrator:\n  TaskCreate({ content: "...", parentId: "${taskId}" })\n  Update them as you work: TaskUpdate({ id: "<subtask-id>", status: "in_progress" })`;

	return `## Your Assigned Task
You have been assigned task **${taskId}**.

**Lifecycle (required — the orchestrator tracks these):**
1. When you begin: \`TaskUpdate({ id: "${taskId}", status: "in_progress", owner: "${agentId}" })\`
2. Optionally set progress: \`TaskUpdate({ id: "${taskId}", activeForm: "Doing X..." })\`
3. When done: \`TaskUpdate({ id: "${taskId}", status: "completed", owner: "${agentId}" })\`
4. If you need clarification from the orchestrator: \`ask_supervisor({ question: "..." })\` — this will block you until answered.
5. For progress updates: \`notify_parent({ message: "..." })\` — task_id is auto-injected, updates the widget spinner text.

${subtaskSection}`;
}
