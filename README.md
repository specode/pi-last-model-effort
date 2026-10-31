# pi-last-model-effort

[English](./README.md) | [简体中文](./README.zh-CN.md)

A [Pi](https://github.com/earendil-works/pi-mono) extension that remembers the thinking effort you last used for each model and restores the last active model and effort in new TUI sessions.

## Installation

Requires a Pi version that exposes `ExtensionContext.mode` (tested with Pi 1.4.0).

From npm:

```bash
pi install npm:@specode/pi-last-model-effort
```

From GitHub:

```bash
pi install git:github.com/specode/pi-last-model-effort
```

From a local directory for development:

```bash
pi install /path/to/pi-last-model-effort
```

Restart Pi after installing.

## Usage

No configuration is needed. Once installed:

- Changing the thinking effort on a model saves that level for that `provider/model`.
- Switching to another model and back restores each model's saved thinking effort.
- Starting a fresh `pi` TUI session or running `/new` restores the most recently selected model and its saved effort.
- If a saved effort is outside what the target model supports, Pi clamps it through `setThinkingLevel()` and saves the resulting level.

### Session Precedence

| Scenario | Behavior |
| --- | --- |
| Fresh TUI `pi` session or `/new` | Restores the last selected model and its saved effort |
| Switch or cycle models in-session | Restores the saved effort for the selected model |
| `pi -c`, `/resume`, fork, clone, `/reload` | Keeps the session's existing model and effort |
| CLI flags (`--model`, `--provider`, `--thinking`, `--models` with `:thinking`) | CLI flags take precedence |
| Scoped model (`--models` / `enabledModels`) with pinned effort | Pinned effort takes precedence |
| Non-TUI modes (`rpc`, `json`, `print`) or `PI_SUBAGENT_CHILD=1` | Ignored; does not read, restore, or write state |
| Saved model unavailable or missing credentials | Keeps Pi's current selection and shows a warning |

## Configuration

State is stored in `~/.pi/agent/state/last-model-effort.json` (following Pi's agent directory). Set `PI_LAST_MODEL_EFFORT_STATE` to override the state file path in tests or isolated environments.

## Privacy and Safety

- Makes no network requests and reads no credentials.
- Does not modify `settings.json`, `modelThinkingLevels`, or session files.
- Runs only when `ctx.mode === "tui"` and ignores `PI_SUBAGENT_CHILD=1` subprocesses so non-interactive or subagent runs never overwrite your preferences.
- Uses file locking, timestamp merging, and atomic writes (`0600`) so multiple Pi terminals can run at the same time without corrupting state.

## Development

```bash
# Run tests (requires Node.js with native TypeScript support)
npm test

# Check package contents
npm run pack:check

# Load the extension directly in Pi without installing
pi --no-extensions --offline -e ./src/index.ts --list-models
```

## License

[MIT](./LICENSE).
