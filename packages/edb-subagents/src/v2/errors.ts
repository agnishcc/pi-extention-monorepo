export class CoordinatorError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly details?: unknown,
	) {
		super(message);
		this.name = "CoordinatorError";
	}
}

export class InvalidTransitionError extends CoordinatorError {
	constructor(entityId: string, currentState: string, event: string) {
		super("INVALID_TRANSITION", `Cannot apply ${event} to ${entityId} while it is ${currentState}`, {
			entityId,
			currentState,
			event,
		});
		this.name = "InvalidTransitionError";
	}
}

export class PermissionDeniedError extends CoordinatorError {
	constructor(message: string, details?: unknown) {
		super("PERMISSION_DENIED", message, details);
		this.name = "PermissionDeniedError";
	}
}

export class EntityNotFoundError extends CoordinatorError {
	constructor(kind: string, id: string) {
		super("NOT_FOUND", `${kind} ${id} was not found`, { kind, id });
		this.name = "EntityNotFoundError";
	}
}

export class LimitExceededError extends CoordinatorError {
	constructor(limit: string, value: number) {
		super("LIMIT_EXCEEDED", `${limit} limit exceeded`, { limit, value });
		this.name = "LimitExceededError";
	}
}

export class TodoUnavailableError extends CoordinatorError {
	constructor() {
		super("TODO_UNAVAILABLE", "Task-linked agents require the edb-todo V1 service");
		this.name = "TodoUnavailableError";
	}
}
