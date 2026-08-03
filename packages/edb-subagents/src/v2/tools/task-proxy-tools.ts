import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Coordinator } from "../coordinator/coordinator.js";

function result(value: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value };
}

export function createTaskProxyTools(coordinator: Coordinator, agentId: string): ToolDefinition[] {
	return [
		defineTool({
			name: "TaskCreate",
			label: "TaskCreate",
			description: "Create one or more tasks through the root todo authority.",
			parameters: Type.Object({
				content: Type.Optional(Type.String()),
				tasks: Type.Optional(
					Type.Array(Type.Object({ content: Type.String(), description: Type.Optional(Type.String()) })),
				),
				description: Type.Optional(Type.String()),
			}),
			async execute(_id, params, signal) {
				const caller = coordinator.caller(agentId, signal ?? new AbortController().signal);
				if (params.tasks?.length)
					return result(await coordinator.taskRequest(caller, "createMany", { tasks: params.tasks }, true));
				if (!params.content) throw new Error("TaskCreate requires content or tasks");
				return result(
					await coordinator.taskRequest(
						caller,
						"create",
						{ content: params.content, description: params.description },
						true,
					),
				);
			},
		}),
		defineTool({
			name: "TaskList",
			label: "TaskList",
			description: "List tasks through the root todo authority.",
			parameters: Type.Object({}),
			async execute(_id, _params, signal) {
				return result(
					await coordinator.taskRequest(
						coordinator.caller(agentId, signal ?? new AbortController().signal),
						"list",
						{},
						false,
					),
				);
			},
		}),
		defineTool({
			name: "TaskGet",
			label: "TaskGet",
			description: "Get a task through the root todo authority.",
			parameters: Type.Object({ id: Type.String() }),
			async execute(_id, params, signal) {
				return result(
					await coordinator.taskRequest(
						coordinator.caller(agentId, signal ?? new AbortController().signal),
						"get",
						{ taskId: params.id },
						false,
					),
				);
			},
		}),
		defineTool({
			name: "TaskUpdate",
			label: "TaskUpdate",
			description: "Update a task through the root todo authority.",
			parameters: Type.Object({ id: Type.String(), patch: Type.Record(Type.String(), Type.Any()) }),
			async execute(_id, params, signal) {
				return result(
					await coordinator.taskRequest(
						coordinator.caller(agentId, signal ?? new AbortController().signal),
						"update",
						{ taskId: params.id, patch: params.patch },
						true,
					),
				);
			},
		}),
	];
}
