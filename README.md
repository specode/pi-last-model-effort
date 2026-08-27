# pi-last-model-effort

[简体中文](./README.zh-CN.md)

A small [Pi](https://github.com/earendil-works/pi-mono) extension that remembers the most recently used thinking/reasoning effort for each model and restores it when you switch back.

## Why

Different models often work best at different reasoning levels. Pi can configure defaults, but switching among several models still means repeatedly adjusting the thinking level. This extension turns the last effective level used by each model into a lightweight, cross-session preference.

## Features

- Remembers thinking effort independently for each `provider/model` pair.
- Restores the remembered effort when returning to a model.
- Restores the most recently selected model in a fresh Pi session.
- Preserves the target session's model and effort for `pi -c`, `/resume`, fork, clone, and reload flows.
- Respects explicit `--model`, `--provider`, and `--thinking` CLI options.
- Respects `enabledModels`, `--models`, and effort values pinned by scoped model entries.
- Uses Pi's native `setThinkingLevel()` behavior, so unsupported levels are safely clamped to the model's capabilities.
- Supports concurrent Pi processes with locked, merged, and atomic state updates.
- Works in TUI, RPC, JSON, and print modes.
- Ignores Pi processes marked with `PI_SUBAGENT_CHILD=1`, preventing fixed subagent effort levels from changing the main-session preference.

## Installation

Install directly from GitHub:

```bash
pi install git:github.com/specode/pi-last-model-effort
```

Try it for one run without installing:

```bash
pi -e git:github.com/specode/pi-last-model-effort
```

Restart Pi after installation. No configuration is required.

## Behavior

| Situation | Behavior |
| --- | --- |
| Fresh `pi` session or `/new` | Restores the most recently selected model and its remembered effort |
| Switch or cycle models | Restores the target model's remembered effort |
| `pi -c`, `/resume`, fork, clone, reload | Keeps the session's own model and effort |
| Explicit CLI model or effort | CLI selection takes precedence |
| Scoped model with a pinned effort | Scoped effort takes precedence |
| Model unavailable or authentication missing | Keeps Pi's current selection and reports a warning |

The effective level after Pi clamps it to the model's capabilities becomes the new remembered value.

## State

State is stored outside your settings and session files:

```text
~/.pi/agent/state/last-model-effort.json
```

The location follows Pi's configured agent directory. Set `PI_LAST_MODEL_EFFORT_STATE` to override the exact file path, mainly for testing or isolated environments.

The extension does not modify Pi's `modelThinkingLevels` setting and does not make network requests.

## Compatibility

The extension uses Pi's public extension APIs and has been verified with Pi 0.84.3. It declares `@earendil-works/pi-coding-agent` as a peer dependency, as recommended for Pi packages.

## Development

Run the tests:

```bash
npm test
```

Verify that Pi can load the extension:

```bash
npm run smoke
```

## License

[MIT](./LICENSE)
