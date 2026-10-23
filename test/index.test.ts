import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { rememberModelEffort, type ThinkingLevel } from "../src/core.ts";

// Stub only the three Pi runtime imports; exercise real extension handlers and
// state storage without installing Pi or touching the user's preferences.
const piStub = `
export function getAgentDir() { throw new Error("Expected isolated state path"); }
export function buildSessionContext() { return { messages: [] }; }
export function parseArgs(args) {
  return { thinking: args[0] === "--thinking" ? args[1] : undefined };
}
`;
const hooks = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === "@earendil-works/pi-coding-agent") {
			return {
				url: `data:text/javascript,${encodeURIComponent(piStub)}`,
				shortCircuit: true,
			};
		}
		return nextResolve(specifier, context);
	},
});
const { default: lastModelEffort } = await import("../src/index.ts");
hooks.deregister();

type Handler = (event: any, ctx: ExtensionContext) => unknown;

async function withFixture(
	run: (path: string, create: (mode: unknown) => ReturnType<typeof createHarness>) => Promise<void>,
): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), "last-model-effort-mode-"));
	const path = join(directory, "state.json");
	const previousPath = process.env.PI_LAST_MODEL_EFFORT_STATE;
	const previousMarker = process.env.PI_SUBAGENT_CHILD;
	const previousArgv = process.argv;
	process.env.PI_LAST_MODEL_EFFORT_STATE = path;
	delete process.env.PI_SUBAGENT_CHILD;
	process.argv = ["node", "pi"];
	try {
		await run(path, createHarness);
	} finally {
		if (previousPath === undefined) delete process.env.PI_LAST_MODEL_EFFORT_STATE;
		else process.env.PI_LAST_MODEL_EFFORT_STATE = previousPath;
		if (previousMarker === undefined) delete process.env.PI_SUBAGENT_CHILD;
		else process.env.PI_SUBAGENT_CHILD = previousMarker;
		process.argv = previousArgv;
		await rm(directory, { recursive: true, force: true });
	}
}

function createHarness(mode: unknown) {
	const handlers = new Map<string, Handler>();
	let thinking: ThinkingLevel = "low";
	let changes = 0;
	const ctx = {
		mode,
		// RPC also has UI: this must not be used to decide whether to run.
		hasUI: true,
		model: { provider: "test", id: "initial" },
		scopedModels: [],
		sessionManager: { getEntries: () => [], getLeafId: () => null },
		modelRegistry: { find: (provider: string, id: string) => ({ provider, id }) },
	} as unknown as ExtensionContext;
	lastModelEffort({
		on: (name: string, handler: Handler) => handlers.set(name, handler),
		getThinkingLevel: () => thinking,
		setThinkingLevel: (level: ThinkingLevel) => {
			changes++;
			thinking = level;
		},
		setModel: async (model: ExtensionContext["model"]) => {
			changes++;
			ctx.model = model;
			return true;
		},
	} as unknown as ExtensionAPI);
	return {
		ctx,
		get changes() { return changes; },
		get thinking() { return thinking; },
		setThinking(level: ThinkingLevel) { thinking = level; },
		async emit(name: string, event: object = {}) {
			await handlers.get(name)?.(event, ctx);
		},
	};
}

const saved = rememberModelEffort(
	undefined, "test", "remembered", "high", "2020-01-01T00:00:00.000Z",
);

for (const mode of ["rpc", "json", "print", undefined, "unknown"]) {
	test(`ignores all lifecycle events in ${String(mode)} mode`, async () => {
		await withFixture(async (path, create) => {
			const original = `${JSON.stringify(saved)}\n`;
			await writeFile(path, original);
			const harness = create(mode);
			await harness.emit("session_start", { reason: "startup" });
			for (const source of ["set", "cycle", "restore"]) {
				await harness.emit("model_select", { source, model: harness.ctx.model });
			}
			await harness.emit("thinking_level_select", { level: "low" });
			await harness.emit("session_shutdown");
			await new Promise((resolve) => setTimeout(resolve, 10));
			assert.equal(harness.changes, 0);
			assert.equal(await readFile(path, "utf8"), original);

			await rm(path);
			await harness.emit("session_start", { reason: "new" });
			await harness.emit("session_shutdown");
			await assert.rejects(readFile(path), { code: "ENOENT" });
		});
	});
}

test("TUI still restores the recent model and effort", async () => {
	await withFixture(async (path, create) => {
		await writeFile(path, JSON.stringify(saved));
		const harness = create("tui");
		await harness.emit("session_start", { reason: "startup" });
		await harness.emit("session_shutdown");
		assert.equal(harness.ctx.model?.id, "remembered");
		assert.equal(harness.thinking, "high");
		assert.equal(harness.changes, 2);
	});
});

test("TUI still persists startup, model selection, and pending thinking changes", async () => {
	await withFixture(async (path, create) => {
		const harness = create("tui");
		await harness.emit("session_start", { reason: "startup" });
		assert.equal(JSON.parse(await readFile(path, "utf8")).lastSelection.modelId, "initial");
		const previousModel = harness.ctx.model;
		harness.ctx.model = { provider: "test", id: "selected" } as ExtensionContext["model"];
		await harness.emit("model_select", { source: "set", model: harness.ctx.model, previousModel });
		harness.setThinking("high");
		await harness.emit("thinking_level_select", { level: "high" });
		await harness.emit("session_shutdown");
		const result = JSON.parse(await readFile(path, "utf8"));
		assert.equal(result.lastSelection.modelId, "selected");
		assert.equal(result.effortByModel["test/selected"].thinkingLevel, "high");
	});
});

test("marked subagents remain disabled even in TUI mode", async () => {
	await withFixture(async (path, create) => {
		process.env.PI_SUBAGENT_CHILD = "1";
		const harness = create("tui");
		await harness.emit("session_start", { reason: "startup" });
		await harness.emit("session_shutdown");
		assert.equal(harness.changes, 0);
		await assert.rejects(readFile(path), { code: "ENOENT" });
	});
});
