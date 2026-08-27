import { randomUUID } from "node:crypto";
import {
	mkdir,
	readFile,
	rename,
	rm,
	stat,
	unlink,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
	parseLastModelEffortState,
	type LastModelEffortState,
	type ThinkingLevelGuard,
} from "./core.ts";

const LOCK_RETRY_MS = 10;
const STALE_LOCK_MS = 30_000;
const LOCK_TIMEOUT_MS = STALE_LOCK_MS + 5_000;
const LOCK_OWNER_FILE = "owner.json";

interface LockOwner {
	pid: number;
	token: string;
	createdAt: string;
}

export interface LoadedLastModelEffortState {
	state?: LastModelEffortState;
	invalid: boolean;
}

function errorCode(error: unknown): string | undefined {
	return (error as NodeJS.ErrnoException).code;
}

async function sleep(milliseconds: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseLockOwner(value: unknown): LockOwner | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Partial<LockOwner>;
	if (
		!Number.isInteger(candidate.pid) ||
		(candidate.pid ?? 0) <= 0 ||
		typeof candidate.token !== "string" ||
		candidate.token === "" ||
		typeof candidate.createdAt !== "string"
	) {
		return undefined;
	}
	return candidate as LockOwner;
}

async function readLockOwner(lockPath: string): Promise<LockOwner | undefined> {
	try {
		return parseLockOwner(
			JSON.parse(await readFile(join(lockPath, LOCK_OWNER_FILE), "utf8")),
		);
	} catch {
		return undefined;
	}
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return errorCode(error) !== "ESRCH";
	}
}

export async function loadLastModelEffortState(
	path: string,
	isThinkingLevel: ThinkingLevelGuard,
): Promise<LoadedLastModelEffortState> {
	let content: string;
	try {
		content = await readFile(path, "utf8");
	} catch (error) {
		if (errorCode(error) === "ENOENT") return { invalid: false };
		throw error;
	}

	try {
		const state = parseLastModelEffortState(JSON.parse(content), isThinkingLevel);
		return state ? { state, invalid: false } : { invalid: true };
	} catch (error) {
		if (error instanceof SyntaxError) return { invalid: true };
		throw error;
	}
}

async function writeStateAtomically(
	path: string,
	state: LastModelEffortState,
): Promise<void> {
	const directory = dirname(path);
	const temporary = join(
		directory,
		`.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
	);

	try {
		await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		await rename(temporary, path);
	} finally {
		try {
			await unlink(temporary);
		} catch {
			// The rename already removed the temporary path on success.
		}
	}
}

async function acquireStateLock(path: string): Promise<() => Promise<void>> {
	const lockPath = `${path}.lock`;
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	const owner: LockOwner = {
		pid: process.pid,
		token: randomUUID(),
		createdAt: new Date().toISOString(),
	};

	while (true) {
		try {
			await mkdir(lockPath, { mode: 0o700 });
			try {
				await writeFile(
					join(lockPath, LOCK_OWNER_FILE),
					`${JSON.stringify(owner)}\n`,
					{ encoding: "utf8", mode: 0o600 },
				);
			} catch (error) {
				await rm(lockPath, { recursive: true, force: true });
				throw error;
			}
			return async () => {
				const currentOwner = await readLockOwner(lockPath);
				if (currentOwner?.token === owner.token) {
					await rm(lockPath, { recursive: true, force: true });
				}
			};
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;

			const currentOwner = await readLockOwner(lockPath);
			if (currentOwner && !processIsAlive(currentOwner.pid)) {
				await rm(lockPath, { recursive: true, force: true });
				continue;
			}

			try {
				const lockStat = await stat(lockPath);
				if (Date.now() - lockStat.mtimeMs > STALE_LOCK_MS) {
					await rm(lockPath, { recursive: true, force: true });
					continue;
				}
			} catch (lockError) {
				if (errorCode(lockError) === "ENOENT") continue;
				throw lockError;
			}

			if (Date.now() >= deadline) {
				throw new Error(`Timed out waiting for state lock: ${lockPath}`);
			}
			await sleep(LOCK_RETRY_MS);
		}
	}
}

export async function updateLastModelEffortState(
	path: string,
	isThinkingLevel: ThinkingLevelGuard,
	update: (current: LastModelEffortState | undefined) => LastModelEffortState,
): Promise<LastModelEffortState> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const release = await acquireStateLock(path);
	try {
		const loaded = await loadLastModelEffortState(path, isThinkingLevel);
		const next = update(loaded.state);
		await writeStateAtomically(path, next);
		return next;
	} finally {
		await release();
	}
}
