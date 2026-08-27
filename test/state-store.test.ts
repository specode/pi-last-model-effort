import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
	getRememberedThinkingLevel,
	rememberModelEffort,
	type ThinkingLevel,
} from "../src/core.ts";
import {
	loadLastModelEffortState,
	updateLastModelEffortState,
} from "../src/state-store.ts";

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

async function withStatePath(
	run: (statePath: string) => Promise<void>,
): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), "last-model-effort-"));
	try {
		await run(join(directory, "state", "last-model-effort.json"));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test("migrates version 1 state on the next atomic update", async () => {
	await withStatePath(async (statePath) => {
		await mkdir(dirname(statePath), { recursive: true });
		await writeFile(
			statePath,
			JSON.stringify({
				version: 1,
				provider: "openai-codex",
				modelId: "gpt-5.6-sol",
				thinkingLevel: "xhigh",
				updatedAt: "2026-08-25T08:00:00.000Z",
			}),
		);

		await updateLastModelEffortState(statePath, isTestThinkingLevel, (current) =>
			rememberModelEffort(
				current,
				"xai",
				"grok-4.6",
				"medium",
				"2026-08-25T09:00:00.000Z",
			),
		);

		const raw = JSON.parse(await readFile(statePath, "utf8"));
		assert.equal(raw.version, 2);
		assert.equal(
			raw.effortByModel["openai-codex/gpt-5.6-sol"].thinkingLevel,
			"xhigh",
		);
		assert.equal(raw.effortByModel["xai/grok-4.6"].thinkingLevel, "medium");
	});
});

test("replaces malformed JSON with the next valid observation", async () => {
	await withStatePath(async (statePath) => {
		await mkdir(dirname(statePath), { recursive: true });
		await writeFile(statePath, "{not-json");

		const invalid = await loadLastModelEffortState(
			statePath,
			isTestThinkingLevel,
		);
		assert.equal(invalid.invalid, true);

		await updateLastModelEffortState(statePath, isTestThinkingLevel, (current) =>
			rememberModelEffort(
				current,
				"xai",
				"grok-4.6",
				"high",
				"2026-08-25T09:00:00.000Z",
			),
		);

		const loaded = await loadLastModelEffortState(statePath, isTestThinkingLevel);
		assert.equal(loaded.invalid, false);
		assert.equal(
			getRememberedThinkingLevel(loaded.state, "xai", "grok-4.6"),
			"high",
		);
	});
});

test("recovers a lock left by a dead process", async () => {
	await withStatePath(async (statePath) => {
		const lockPath = `${statePath}.lock`;
		await mkdir(lockPath, { recursive: true });
		await writeFile(
			join(lockPath, "owner.json"),
			JSON.stringify({
				pid: 99_999_999,
				token: "orphaned-lock",
				createdAt: "2026-08-25T09:00:00.000Z",
			}),
		);

		await updateLastModelEffortState(statePath, isTestThinkingLevel, (current) =>
			rememberModelEffort(
				current,
				"xai",
				"grok-4.6",
				"high",
				"2026-08-25T09:00:00.000Z",
			),
		);

		const loaded = await loadLastModelEffortState(statePath, isTestThinkingLevel);
		assert.equal(
			getRememberedThinkingLevel(loaded.state, "xai", "grok-4.6"),
			"high",
		);
	});
});

test("serializes concurrent process-style updates without losing models", async () => {
	await withStatePath(async (statePath) => {
		const count = 20;
		await Promise.all(
			Array.from({ length: count }, (_, index) =>
				updateLastModelEffortState(statePath, isTestThinkingLevel, (current) =>
					rememberModelEffort(
						current,
						"test-provider",
						`model-${index}`,
						index % 2 === 0 ? "high" : "low",
						new Date(Date.UTC(2026, 7, 25, 10, 0, index)).toISOString(),
					),
				),
			),
		);

		const loaded = await loadLastModelEffortState(statePath, isTestThinkingLevel);
		assert.equal(loaded.invalid, false);
		assert.equal(Object.keys(loaded.state?.effortByModel ?? {}).length, count);
		for (let index = 0; index < count; index++) {
			assert.equal(
				getRememberedThinkingLevel(loaded.state, "test-provider", `model-${index}`),
				index % 2 === 0 ? "high" : "low",
			);
		}
	});
});
