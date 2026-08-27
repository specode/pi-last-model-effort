import { join, resolve } from "node:path";
import {
	getAgentDir,
	parseArgs,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	getRememberedThinkingLevel,
	hasModelThinkingSuffix,
	mergeLastModelEffortStates,
	modelEffortKey,
	rememberModelEffort,
	RestoreThinkingEventGate,
	shouldManageLastSelection,
	shouldRestoreLastSelection,
	type LastModelEffortState,
	type LastModelSelection,
	type ThinkingLevel,
} from "./core.ts";
import {
	ThinkingObservationCoordinator,
	type EffortModelReference,
} from "./event-coordinator.ts";
import {
	loadLastModelEffortState,
	updateLastModelEffortState,
} from "./state-store.ts";

const STATE_FILE_NAME = "last-model-effort.json";

function isSystemThinkingLevel(value: unknown): value is ThinkingLevel {
	return (
		typeof value === "string" &&
		parseArgs(["--thinking", value]).thinking === value
	);
}

function getStatePath(): string {
	const override = process.env.PI_LAST_MODEL_EFFORT_STATE?.trim();
	return override
		? resolve(override)
		: join(getAgentDir(), "state", STATE_FILE_NAME);
}

function selectionMatchesModel(
	selection: LastModelSelection,
	model: EffortModelReference | undefined,
): boolean {
	return (
		model?.provider === selection.provider && model.id === selection.modelId
	);
}

function scopedThinkingLevel(
	ctx: ExtensionContext,
	provider = ctx.model?.provider,
	modelId = ctx.model?.id,
): ThinkingLevel | undefined {
	if (!provider || !modelId) return undefined;
	return ctx.scopedModels.find(
		(entry) => entry.model.provider === provider && entry.model.id === modelId,
	)?.thinkingLevel;
}

function modelAllowedByScope(
	ctx: ExtensionContext,
	selection: LastModelSelection,
): boolean {
	return (
		ctx.scopedModels.length === 0 ||
		ctx.scopedModels.some(
			(entry) =>
				entry.model.provider === selection.provider &&
				entry.model.id === selection.modelId,
		)
	);
}

function warn(ctx: ExtensionContext, message: string): void {
	if (ctx.hasUI) ctx.ui.notify(message, "warning");
	else console.error(`[last-model-effort] ${message}`);
}

export default function lastModelEffort(pi: ExtensionAPI): void {
	if (!shouldManageLastSelection(process.env.PI_SUBAGENT_CHILD)) return;

	const statePath = getStatePath();
	const restoreThinkingEvents = new RestoreThinkingEventGate();
	let state: LastModelEffortState | undefined;
	let invalidStateWarned = false;
	let writeQueue: Promise<void> = Promise.resolve();

	function reportInvalidState(): void {
		if (invalidStateWarned) return;
		invalidStateWarned = true;
		console.error(
			`[last-model-effort] Ignoring invalid state file: ${statePath}`,
		);
	}

	async function refreshState(): Promise<LastModelEffortState | undefined> {
		await writeQueue;
		try {
			const loaded = await loadLastModelEffortState(
				statePath,
				isSystemThinkingLevel,
			);
			if (loaded.invalid) reportInvalidState();
			state = mergeLastModelEffortStates(state, loaded.state);
		} catch (error) {
			console.error(`[last-model-effort] Failed to read ${statePath}:`, error);
		}
		return state;
	}

	function enqueueStateUpdate(
		update: (current: LastModelEffortState | undefined) => LastModelEffortState,
	): Promise<void> {
		writeQueue = writeQueue
			.then(async () => {
				state = await updateLastModelEffortState(
					statePath,
					isSystemThinkingLevel,
					(current) => update(mergeLastModelEffortStates(state, current)),
				);
			})
			.catch((error) => {
				console.error(`[last-model-effort] Failed to write ${statePath}:`, error);
			});
		return writeQueue;
	}

	function persistEffort(
		provider: string,
		modelId: string,
		thinkingLevel: ThinkingLevel,
		updatedAt = new Date().toISOString(),
	): Promise<void> {
		return enqueueStateUpdate((current) =>
			rememberModelEffort(current, provider, modelId, thinkingLevel, updatedAt),
		);
	}

	function persistCurrent(ctx: ExtensionContext): Promise<void> {
		if (!ctx.model) return Promise.resolve();
		return persistEffort(ctx.model.provider, ctx.model.id, pi.getThinkingLevel());
	}

	function trackRestoreThinkingChange<T>(
		operation: () => T | Promise<T>,
	): Promise<T> {
		return restoreThinkingEvents.track(() => pi.getThinkingLevel(), operation);
	}

	const thinkingObservations = new ThinkingObservationCoordinator(
		() => pi.getThinkingLevel(),
		(observation) =>
			persistEffort(
				observation.provider,
				observation.modelId,
				observation.thinkingLevel,
				observation.observedAt,
			),
	);

	async function restoreRecentModel(
		saved: LastModelEffortState,
		explicitModel: boolean,
		ctx: ExtensionContext,
	): Promise<boolean> {
		if (explicitModel || selectionMatchesModel(saved.lastSelection, ctx.model)) {
			return true;
		}

		const modelLabel = modelEffortKey(
			saved.lastSelection.provider,
			saved.lastSelection.modelId,
		);
		if (!modelAllowedByScope(ctx, saved.lastSelection)) {
			warn(
				ctx,
				`Could not restore recent model ${modelLabel}: it is outside the current scoped models`,
			);
			return false;
		}

		const model = ctx.modelRegistry.find(
			saved.lastSelection.provider,
			saved.lastSelection.modelId,
		);
		if (!model) {
			warn(
				ctx,
				`Could not restore recent model ${modelLabel}: the model is unavailable`,
			);
			return false;
		}

		const restored = await trackRestoreThinkingChange(() => pi.setModel(model));
		if (!restored) {
			warn(
				ctx,
				`Could not restore recent model ${modelLabel}: authentication is unavailable`,
			);
		}
		return restored;
	}

	async function restoreStartupThinking(
		saved: LastModelEffortState,
		explicitThinking: boolean,
		initialThinking: ThinkingLevel,
		ctx: ExtensionContext,
	): Promise<void> {
		if (!ctx.model) return;
		const targetThinking = explicitThinking
			? initialThinking
			: (scopedThinkingLevel(ctx) ??
				getRememberedThinkingLevel(saved, ctx.model.provider, ctx.model.id) ??
				pi.getThinkingLevel());
		await trackRestoreThinkingChange(() => pi.setThinkingLevel(targetThinking));
	}

	pi.on("session_start", async (event, ctx) => {
		thinkingObservations.setActiveModel(ctx.model);
		const saved = await refreshState();
		const args = parseArgs(process.argv.slice(2));
		const hasSessionRestore =
			args.continue === true ||
			args.resume === true ||
			args.session !== undefined ||
			args.fork !== undefined;
		const hasConversation =
			ctx.sessionManager.buildSessionContext().messages.length > 0;

		if (
			!saved ||
			!shouldRestoreLastSelection(event.reason, hasSessionRestore, hasConversation)
		) {
			await persistCurrent(ctx);
			return;
		}

		const explicitModel = args.model !== undefined || args.provider !== undefined;
		const explicitThinking =
			args.thinking !== undefined ||
			hasModelThinkingSuffix(args.model, isSystemThinkingLevel);
		const initialThinking = pi.getThinkingLevel();

		restoreThinkingEvents.begin();
		let modelRestored = false;
		try {
			modelRestored = await restoreRecentModel(saved, explicitModel, ctx);
			if (modelRestored) {
				await restoreStartupThinking(saved, explicitThinking, initialThinking, ctx);
			}
		} finally {
			restoreThinkingEvents.end();
		}

		if (modelRestored) await persistCurrent(ctx);
	});

	pi.on("model_select", async (event, ctx) => {
		await thinkingObservations.beforeModelSelect(event.previousModel);
		thinkingObservations.setActiveModel(event.model);
		if (restoreThinkingEvents.isRestoring) return;

		if (event.source === "restore") {
			await persistCurrent(ctx);
			return;
		}

		const latest = await refreshState();
		const targetThinking =
			scopedThinkingLevel(ctx, event.model.provider, event.model.id) ??
			getRememberedThinkingLevel(latest, event.model.provider, event.model.id);

		if (targetThinking !== undefined) {
			restoreThinkingEvents.begin();
			try {
				await trackRestoreThinkingChange(() => pi.setThinkingLevel(targetThinking));
			} finally {
				restoreThinkingEvents.end();
			}
		}

		await persistCurrent(ctx);
	});

	pi.on("thinking_level_select", (event, ctx) => {
		if (restoreThinkingEvents.shouldSuppressThinkingEvent()) return;
		thinkingObservations.observe(ctx.model, event.level);
	});

	pi.on("session_shutdown", async () => {
		await thinkingObservations.flush();
		await writeQueue;
	});
}
