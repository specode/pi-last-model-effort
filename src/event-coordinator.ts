import type { ThinkingLevel } from "./core.ts";

export interface EffortModelReference {
	provider: string;
	id: string;
}

export interface ThinkingObservation {
	provider: string;
	modelId: string;
	thinkingLevel: ThinkingLevel;
	observedAt: string;
}

interface PendingThinkingObservation extends ThinkingObservation {
	timer?: ReturnType<typeof setTimeout>;
}

function observationMatchesModel(
	observation: ThinkingObservation,
	model: EffortModelReference | undefined,
): boolean {
	return (
		model?.provider === observation.provider && model.id === observation.modelId
	);
}

function withoutTimer(
	observation: PendingThinkingObservation,
): ThinkingObservation {
	return {
		provider: observation.provider,
		modelId: observation.modelId,
		thinkingLevel: observation.thinkingLevel,
		observedAt: observation.observedAt,
	};
}

export class ThinkingObservationCoordinator {
	private activeModel: EffortModelReference | undefined;
	private pending: PendingThinkingObservation | undefined;
	private readonly currentThinkingLevel: () => ThinkingLevel;
	private readonly commit: (observation: ThinkingObservation) => Promise<void>;

	constructor(
		currentThinkingLevel: () => ThinkingLevel,
		commit: (observation: ThinkingObservation) => Promise<void>,
	) {
		this.currentThinkingLevel = currentThinkingLevel;
		this.commit = commit;
	}

	setActiveModel(model: EffortModelReference | undefined): void {
		this.activeModel = model;
	}

	private takePending(): PendingThinkingObservation | undefined {
		const observation = this.pending;
		if (!observation) return undefined;
		if (observation.timer) clearTimeout(observation.timer);
		this.pending = undefined;
		return observation;
	}

	private async commitIfCurrent(
		observation: ThinkingObservation,
	): Promise<void> {
		if (
			!observationMatchesModel(observation, this.activeModel) ||
			this.currentThinkingLevel() !== observation.thinkingLevel
		) {
			return;
		}
		await this.commit(withoutTimer(observation));
	}

	observe(
		model: EffortModelReference | undefined,
		thinkingLevel: ThinkingLevel,
		observedAt = new Date().toISOString(),
	): void {
		if (!model) return;
		const previous = this.takePending();
		if (previous && observationMatchesModel(previous, this.activeModel)) {
			// A following model-change thinking event can arrive before model_select.
			// The previous observation still belongs to the active model, so persist it
			// without comparing against the incoming model's current level.
			void this.commit(withoutTimer(previous));
		}

		const observation: PendingThinkingObservation = {
			provider: model.provider,
			modelId: model.id,
			thinkingLevel,
			observedAt,
		};
		observation.timer = setTimeout(() => {
			if (this.pending !== observation) return;
			this.pending = undefined;
			void this.commitIfCurrent(observation);
		}, 0);
		this.pending = observation;
	}

	async beforeModelSelect(
		previousModel: EffortModelReference | undefined,
	): Promise<void> {
		const pending = this.takePending();
		if (pending && observationMatchesModel(pending, previousModel)) {
			await this.commit(withoutTimer(pending));
		}
	}

	async flush(): Promise<void> {
		const pending = this.takePending();
		if (pending) await this.commitIfCurrent(pending);
	}
}
