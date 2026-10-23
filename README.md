# pi-last-model-effort

[English](./README.md) | [简体中文](./README.zh-CN.md)

Automatically remember and restore your preferred thinking/reasoning effort for each model in [Pi](https://github.com/earendil-works/pi-mono) — so switching models never forces you to readjust the thinking level by hand.

- **Per-model memory** — tracks the last effective thinking effort independently for every `provider/model` pair.
- **Seamless session startup** — restores your most recently used model and its remembered effort when opening a fresh `pi` session or running `/new`.
- **Non-intrusive precedence** — respects resumed sessions (`pi -c`, `/resume`), CLI flags (`--model`, `--thinking`), and pinned scoped-model settings.
- **Zero configuration** — install once and use Pi's normal model and thinking selectors as usual.

---

## Requirements

- [Pi](https://github.com/earendil-works/pi-mono) with `ExtensionContext.mode` support (verified with Pi `1.4.0`). The extension runs only in TUI mode; RPC, JSON, print, and unknown modes are ignored.

---

## Installation

Install from npm:

```bash
pi install npm:@specode/pi-last-model-effort
```

Or install from GitHub:

```bash
pi install git:github.com/specode/pi-last-model-effort
```

Try it for a single session without installing:

```bash
pi -e npm:@specode/pi-last-model-effort
```

Restart Pi after installation. No configuration is needed.

---

## Quick Start

Once installed, the extension works automatically in the background:

1. Select Model A and change its thinking effort (e.g. `high`).
2. Switch to Model B and set a different thinking effort (e.g. `low`).
3. Switch back to Model A — its thinking effort automatically returns to `high`.
4. Open a brand-new `pi` terminal — it starts on your last active model and effort level.

---

## How It Works & Design

### Precedence & Session Rules

To avoid overriding intentional user choices or historical session state, the extension follows strict precedence rules:

| Scenario | Behavior |
| --- | --- |
| **Non-TUI mode (RPC, JSON, print)** | Does not read, restore, or write preferences |
| **Fresh TUI `pi` session or `/new`** | Restores the most recently selected model and its remembered effort |
| **Switch or cycle models in-session** | Restores the target model's remembered effort |
| **`pi -c`, `/resume`, fork, clone, `/reload`** | Preserves the target session's own model and effort |
| **Explicit CLI flags (`--model`, `--provider`, `--thinking`)** | CLI flags always take precedence |
| **Scoped model (`--models` / `enabledModels`) with pinned effort** | Pinned effort takes precedence |
| **Model unavailable or missing credentials** | Keeps Pi's current selection and shows a warning |

### Capability Clamping & Subagent Isolation

- **Native capability clamping**: Restoring effort calls Pi's native `setThinkingLevel()`, so unsupported levels are safely clamped to what the target model supports, and the resulting effective level becomes the new remembered preference.
- **TUI-only operation**: All lifecycle handlers require `ctx.mode === "tui"`. Non-interactive processes do not participate in preference memory, even without a subagent marker.
- **Subagent isolation**: Processes spawned with `PI_SUBAGENT_CHILD=1` are ignored so fixed subagent reasoning levels never overwrite your main session preferences.
- **Multi-process concurrency**: State updates use file locking, timestamp-based merging, and atomic file replacement so running multiple Pi terminals simultaneously never corrupts state.

### State Storage

Preferences are stored in a standalone state file (without modifying your `settings.json`, `modelThinkingLevels`, or session transcripts):

```text
~/.pi/agent/state/last-model-effort.json
```

The path follows Pi's configured agent directory. For testing or isolated environments, set `PI_LAST_MODEL_EFFORT_STATE` to override the file path. The extension makes zero network requests.

---

## Development

```bash
# Run unit tests
npm test

# Verify extension loading in Pi
npm run smoke
```

## License

[MIT](./LICENSE)
