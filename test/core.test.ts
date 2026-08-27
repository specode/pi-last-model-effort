import assert from "node:assert/strict";
import test from "node:test";
import {
	getRememberedThinkingLevel,
	hasModelThinkingSuffix,
	mergeLastModelEffortStates,
	modelEffortKey,
	parseLastModelEffortState,
	rememberLastSelection,
	rememberModelEffort,
	RestoreThinkingEventGate,
	shouldManageLastSelection,
	shouldRestoreLastSelection,
	type LastModelEffortState,
	type ThinkingLevel,
} from "../src/core.ts";

const thinkingLevels = new Set<ThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

function isTestThinkingLevel(value: unknown): value is ThinkingLevel {
	return thinkingLevels.has(value as ThinkingLevel);
}

const legacyState = {
	version: 1,
	provider: "openai-codex",
	modelId: "gpt-5.6-sol",
	thinkingLevel: "xhigh",
	updatedAt: "2026-08-25T08:00:00.000Z",
} as const;

const validState: LastModelEffortState = {
	version: 2,
	lastSelection: {
		provider: "xai",
		modelId: "grok-4.6",
		updatedAt: "2026-08-25T09:00:00.000Z",
	},
	effortByModel: {
		"openai-codex/gpt-5.6-sol": {
			thinkingLevel: "xhigh",
			updatedAt: "2026-08-25T08:00:00.000Z",
		},
		"xai/grok-4.6": {
			thinkingLevel: "high",
			updatedAt: "2026-08-25T09:00:00.000Z",
		},
	},
};

test("migrates a version 1 state record to per-model state", () => {
	assert.deepEqual(parseLastModelEffortState(legacyState, isTestThinkingLevel), {
		version: 2,
		lastSelection: {
			provider: legacyState.provider,
			modelId: legacyState.modelId,
			updatedAt: legacyState.updatedAt,
		},
		effortByModel: {
			"openai-codex/gpt-5.6-sol": {
				thinkingLevel: legacyState.thinkingLevel,
				updatedAt: legacyState.updatedAt,
			},
		},
	});
});

test("parses a valid version 2 state record", () => {
	assert.deepEqual(
		parseLastModelEffortState(validState, isTestThinkingLevel),
		validState,
	);
});

test("rejects malformed state records", () => {
	assert.equal(
		parseLastModelEffortState(
			{
				...validState,
				effortByModel: {
					...validState.effortByModel,
					broken: { thinkingLevel: "ultra", updatedAt: "now" },
				},
			},
			isTestThinkingLevel,
		),
		undefined,
	);
	assert.equal(
		parseLastModelEffortState(
			{
				...validState,
				lastSelection: { ...validState.lastSelection, provider: "" },
			},
			isTestThinkingLevel,
		),
		undefined,
	);
	assert.equal(
		parseLastModelEffortState(
			{ ...legacyState, updatedAt: "not-a-date" },
			isTestThinkingLevel,
		),
		undefined,
	);
});

test("remembers effort independently for each model", () => {
	let state = rememberModelEffort(
		undefined,
		"openai-codex",
		"gpt-5.6-sol",
		"xhigh",
		"2026-08-25T08:00:00.000Z",
	);
	state = rememberModelEffort(
		state,
		"xai",
		"grok-4.6",
		"medium",
		"2026-08-25T09:00:00.000Z",
	);

	assert.equal(
		getRememberedThinkingLevel(state, "openai-codex", "gpt-5.6-sol"),
		"xhigh",
	);
	assert.equal(getRememberedThinkingLevel(state, "xai", "grok-4.6"), "medium");
	assert.equal(state.lastSelection.provider, "xai");
});

test("keeps the newest selection and effort while merging processes", () => {
	const older = rememberModelEffort(
		undefined,
		"openai-codex",
		"gpt-5.6-sol",
		"high",
		"2026-08-25T08:00:00.000Z",
	);
	let newer = rememberModelEffort(
		undefined,
		"openai-codex",
		"gpt-5.6-sol",
		"xhigh",
		"2026-08-25T10:00:00.000Z",
	);
	newer = rememberModelEffort(
		newer,
		"xai",
		"grok-4.6",
		"medium",
		"2026-08-25T09:00:00.000Z",
	);
	newer = rememberLastSelection(
		newer,
		"openai-codex",
		"gpt-5.6-sol",
		"2026-08-25T10:00:00.000Z",
	);

	const merged = mergeLastModelEffortStates(older, newer);
	assert.equal(
		merged?.effortByModel[modelEffortKey("openai-codex", "gpt-5.6-sol")]
			?.thinkingLevel,
		"xhigh",
	);
	assert.equal(
		merged?.effortByModel[modelEffortKey("xai", "grok-4.6")]?.thinkingLevel,
		"medium",
	);
	assert.equal(merged?.lastSelection.modelId, "gpt-5.6-sol");
});

test("does not let an older observation replace a newer effort", () => {
	const current = rememberModelEffort(
		undefined,
		"xai",
		"grok-4.6",
		"high",
		"2026-08-25T10:00:00.000Z",
	);
	const result = rememberModelEffort(
		current,
		"xai",
		"grok-4.6",
		"low",
		"2026-08-25T09:00:00.000Z",
	);
	assert.equal(getRememberedThinkingLevel(result, "xai", "grok-4.6"), "high");
});

test("detects a system thinking suffix on a model argument", () => {
	assert.equal(
		hasModelThinkingSuffix("openai-codex/gpt-5.6-sol:xhigh", isTestThinkingLevel),
		true,
	);
	assert.equal(
		hasModelThinkingSuffix("openai-codex/gpt-5.6-sol", isTestThinkingLevel),
		false,
	);
	assert.equal(
		hasModelThinkingSuffix("ollama/model:custom", isTestThinkingLevel),
		false,
	);
});

test("ignores pi-subagents child processes", () => {
	assert.equal(shouldManageLastSelection("1"), false);
	assert.equal(shouldManageLastSelection("0"), true);
	assert.equal(shouldManageLastSelection(undefined), true);
});

test("restores only into fresh startup or explicitly new sessions", () => {
	assert.equal(shouldRestoreLastSelection("startup", false, false), true);
	assert.equal(shouldRestoreLastSelection("new", false, false), true);
	assert.equal(shouldRestoreLastSelection("startup", true, false), false);
	assert.equal(shouldRestoreLastSelection("startup", false, true), false);
	assert.equal(shouldRestoreLastSelection("resume", false, false), false);
	assert.equal(shouldRestoreLastSelection("fork", false, false), false);
	assert.equal(shouldRestoreLastSelection("reload", false, false), false);
});

test("suppresses a restore thinking event that arrives after restoration", async () => {
	const gate = new RestoreThinkingEventGate();
	let level: ThinkingLevel = "xhigh";
	gate.begin();
	await gate.track(
		() => level,
		() => {
			level = "low";
		},
	);
	gate.end();

	assert.equal(gate.shouldSuppressThinkingEvent(), true);
	assert.equal(gate.shouldSuppressThinkingEvent(), false);
});

test("does not retain a token for an event observed during restoration", async () => {
	const gate = new RestoreThinkingEventGate();
	let level: ThinkingLevel = "medium";
	gate.begin();
	await gate.track(
		() => level,
		() => {
			level = "high";
			assert.equal(gate.shouldSuppressThinkingEvent(), true);
		},
	);
	gate.end();

	assert.equal(gate.shouldSuppressThinkingEvent(), false);
});
