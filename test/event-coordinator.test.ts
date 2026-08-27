import assert from "node:assert/strict";
import test from "node:test";
import type { ThinkingLevel } from "../src/core.ts";
import {
	ThinkingObservationCoordinator,
	type ThinkingObservation,
} from "../src/event-coordinator.ts";

const modelA = { provider: "openai-codex", id: "gpt-5.6-sol" };
const modelB = { provider: "xai", id: "grok-4.6" };

async function nextTimer(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 5));
}

test("commits a normal user effort change after the debounce", async () => {
	const current: ThinkingLevel = "high";
	const committed: ThinkingObservation[] = [];
	const coordinator = new ThinkingObservationCoordinator(
		() => current,
		async (observation) => {
			committed.push(observation);
		},
	);
	coordinator.setActiveModel(modelA);
	coordinator.observe(modelA, current, "2026-08-25T08:00:00.000Z");

	await nextTimer();
	assert.deepEqual(committed, [
		{
			provider: modelA.provider,
			modelId: modelA.id,
			thinkingLevel: "high",
			observedAt: "2026-08-25T08:00:00.000Z",
		},
	]);
});

test("keeps the leaving model effort when model thinking arrives first", async () => {
	let current: ThinkingLevel = "xhigh";
	const committed: ThinkingObservation[] = [];
	const coordinator = new ThinkingObservationCoordinator(
		() => current,
		async (observation) => {
			committed.push(observation);
		},
	);
	coordinator.setActiveModel(modelA);

	// A user changes A, then an extension switches to B in the same event loop.
	coordinator.observe(modelA, "xhigh", "2026-08-25T08:00:00.000Z");
	current = "medium";
	coordinator.observe(modelB, "medium", "2026-08-25T08:00:01.000Z");
	await coordinator.beforeModelSelect(modelA);
	coordinator.setActiveModel(modelB);
	await nextTimer();

	assert.deepEqual(committed, [
		{
			provider: modelA.provider,
			modelId: modelA.id,
			thinkingLevel: "xhigh",
			observedAt: "2026-08-25T08:00:00.000Z",
		},
	]);
});

test("drops the incoming model's temporary switch level", async () => {
	let current: ThinkingLevel = "high";
	const committed: ThinkingObservation[] = [];
	const coordinator = new ThinkingObservationCoordinator(
		() => current,
		async (observation) => {
			committed.push(observation);
		},
	);
	coordinator.setActiveModel(modelA);

	current = "medium";
	coordinator.observe(modelB, "medium", "2026-08-25T08:00:00.000Z");
	await coordinator.beforeModelSelect(modelA);
	coordinator.setActiveModel(modelB);
	current = "low";
	await nextTimer();

	assert.deepEqual(committed, []);
});

test("flushes a valid pending effort during shutdown", async () => {
	const current: ThinkingLevel = "low";
	const committed: ThinkingObservation[] = [];
	const coordinator = new ThinkingObservationCoordinator(
		() => current,
		async (observation) => {
			committed.push(observation);
		},
	);
	coordinator.setActiveModel(modelB);
	coordinator.observe(modelB, current, "2026-08-25T08:00:00.000Z");

	await coordinator.flush();
	assert.equal(committed.length, 1);
});
