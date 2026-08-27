import type {
	ExtensionAPI,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

export type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;
export type ThinkingLevelGuard = (value: unknown) => value is ThinkingLevel;

export interface LastModelSelection {
	provider: string;
	modelId: string;
	updatedAt: string;
}

export interface RememberedModelEffort {
	thinkingLevel: ThinkingLevel;
	updatedAt: string;
}

export interface LastModelEffortState {
	version: 2;
	lastSelection: LastModelSelection;
	effortByModel: Record<string, RememberedModelEffort>;
}

interface LegacyLastModelEffortState {
	version: 1;
	provider: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
	updatedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function isTimestamp(value: unknown): value is string {
	return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function parseSelection(value: unknown): LastModelSelection | undefined {
	if (!isRecord(value)) return undefined;
	if (
		!isNonEmptyString(value.provider) ||
		!isNonEmptyString(value.modelId) ||
		!isTimestamp(value.updatedAt)
	) {
		return undefined;
	}
	return {
		provider: value.provider,
		modelId: value.modelId,
		updatedAt: value.updatedAt,
	};
}

function parseEffort(
	value: unknown,
	isThinkingLevel: ThinkingLevelGuard,
): RememberedModelEffort | undefined {
	if (!isRecord(value)) return undefined;
	if (!isThinkingLevel(value.thinkingLevel) || !isTimestamp(value.updatedAt)) {
		return undefined;
	}
	return {
		thinkingLevel: value.thinkingLevel,
		updatedAt: value.updatedAt,
	};
}

function timestampMs(value: string): number {
	return Date.parse(value);
}

function newer<T extends { updatedAt: string }>(left: T, right: T): T {
	return timestampMs(right.updatedAt) >= timestampMs(left.updatedAt)
		? right
		: left;
}

export function modelEffortKey(provider: string, modelId: string): string {
	return `${provider}/${modelId}`;
}

export function parseLastModelEffortState(
	value: unknown,
	isThinkingLevel: ThinkingLevelGuard,
): LastModelEffortState | undefined {
	if (!isRecord(value)) return undefined;

	if (value.version === 1) {
		const candidate = value as Partial<LegacyLastModelEffortState>;
		if (
			!isNonEmptyString(candidate.provider) ||
			!isNonEmptyString(candidate.modelId) ||
			!isThinkingLevel(candidate.thinkingLevel) ||
			!isTimestamp(candidate.updatedAt)
		) {
			return undefined;
		}
		const key = modelEffortKey(candidate.provider, candidate.modelId);
		return {
			version: 2,
			lastSelection: {
				provider: candidate.provider,
				modelId: candidate.modelId,
				updatedAt: candidate.updatedAt,
			},
			effortByModel: {
				[key]: {
					thinkingLevel: candidate.thinkingLevel,
					updatedAt: candidate.updatedAt,
				},
			},
		};
	}

	if (value.version !== 2) return undefined;
	const lastSelection = parseSelection(value.lastSelection);
	if (!lastSelection || !isRecord(value.effortByModel)) return undefined;

	const effortByModel: Record<string, RememberedModelEffort> = {};
	for (const [key, rawEffort] of Object.entries(value.effortByModel)) {
		if (!isNonEmptyString(key)) return undefined;
		const effort = parseEffort(rawEffort, isThinkingLevel);
		if (!effort) return undefined;
		effortByModel[key] = effort;
	}

	return { version: 2, lastSelection, effortByModel };
}

export function mergeLastModelEffortStates(
	left: LastModelEffortState | undefined,
	right: LastModelEffortState | undefined,
): LastModelEffortState | undefined {
	if (!left) return right ? structuredClone(right) : undefined;
	if (!right) return structuredClone(left);

	const effortByModel: Record<string, RememberedModelEffort> = {
		...structuredClone(left.effortByModel),
	};
	for (const [key, effort] of Object.entries(right.effortByModel)) {
		const existing = effortByModel[key];
		effortByModel[key] = existing
			? structuredClone(newer(existing, effort))
			: structuredClone(effort);
	}

	return {
		version: 2,
		lastSelection: structuredClone(
			newer(left.lastSelection, right.lastSelection),
		),
		effortByModel,
	};
}

export function rememberLastSelection(
	state: LastModelEffortState | undefined,
	provider: string,
	modelId: string,
	updatedAt: string,
): LastModelEffortState {
	const selection: LastModelSelection = { provider, modelId, updatedAt };
	if (!state) {
		return { version: 2, lastSelection: selection, effortByModel: {} };
	}
	return {
		version: 2,
		lastSelection: newer(state.lastSelection, selection),
		effortByModel: structuredClone(state.effortByModel),
	};
}

export function rememberModelEffort(
	state: LastModelEffortState | undefined,
	provider: string,
	modelId: string,
	thinkingLevel: ThinkingLevel,
	updatedAt: string,
): LastModelEffortState {
	const selected = rememberLastSelection(state, provider, modelId, updatedAt);
	const key = modelEffortKey(provider, modelId);
	const effort: RememberedModelEffort = { thinkingLevel, updatedAt };
	const existing = selected.effortByModel[key];
	selected.effortByModel[key] = existing ? newer(existing, effort) : effort;
	return selected;
}

export function getRememberedThinkingLevel(
	state: LastModelEffortState | undefined,
	provider: string,
	modelId: string,
): ThinkingLevel | undefined {
	return state?.effortByModel[modelEffortKey(provider, modelId)]?.thinkingLevel;
}

export class RestoreThinkingEventGate {
	private restoring = false;
	private observedDuringRestore = 0;
	private pendingFromRestore = 0;

	get isRestoring(): boolean {
		return this.restoring;
	}

	begin(): void {
		this.restoring = true;
	}

	end(): void {
		this.restoring = false;
	}

	async track<T>(
		currentLevel: () => ThinkingLevel,
		operation: () => T | Promise<T>,
	): Promise<T> {
		const before = currentLevel();
		const observedBefore = this.observedDuringRestore;
		try {
			return await operation();
		} finally {
			if (
				currentLevel() !== before &&
				this.observedDuringRestore === observedBefore
			) {
				this.pendingFromRestore++;
			}
		}
	}

	shouldSuppressThinkingEvent(): boolean {
		if (this.restoring) {
			this.observedDuringRestore++;
			return true;
		}
		if (this.pendingFromRestore > 0) {
			this.pendingFromRestore--;
			return true;
		}
		return false;
	}
}

export type SessionStartReason = SessionStartEvent["reason"];

export function shouldManageLastSelection(
	subagentChildMarker: string | undefined,
): boolean {
	return subagentChildMarker !== "1";
}

export function hasModelThinkingSuffix(
	model: string | undefined,
	isThinkingLevel: ThinkingLevelGuard,
): boolean {
	if (!model) return false;
	const separator = model.lastIndexOf(":");
	return separator >= 0 && isThinkingLevel(model.slice(separator + 1));
}

export function shouldRestoreLastSelection(
	reason: SessionStartReason,
	hasSessionRestore: boolean,
	hasConversation: boolean,
): boolean {
	if (reason === "new") return true;
	if (reason !== "startup" || hasSessionRestore) return false;
	return !hasConversation;
}
