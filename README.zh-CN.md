# pi-last-model-effort

[English](./README.md)

一个小型 [Pi](https://github.com/earendil-works/pi-mono) 扩展：按模型记住最近实际使用的 thinking / reasoning effort，并在切换回来时自动恢复。

## 为什么需要它

不同模型通常适合不同的推理档位。Pi 可以配置默认值，但在多个模型之间切换时，仍可能需要反复调整 thinking level。这个扩展会把每个模型最近实际使用的档位保存为轻量、跨会话的偏好。

## 功能

- 按 `provider/model` 独立记忆 thinking effort。
- 切换回某个模型时恢复其最近档位。
- 在全新的 Pi 会话中恢复最近选择的模型。
- `pi -c`、`/resume`、fork、clone 和 reload 保留目标会话自己的模型与 effort。
- 尊重显式 `--model`、`--provider` 和 `--thinking` 命令行参数。
- 尊重 `enabledModels`、`--models` 以及 scoped model 条目固定的 effort。
- 通过 Pi 原生 `setThinkingLevel()` 恢复，因此不支持的档位会按照模型能力安全收敛。
- 使用文件锁、按时间戳合并和原子替换，支持多个 Pi 进程并发运行。
- 支持 TUI、RPC、JSON 和 print 模式。
- 忽略带有 `PI_SUBAGENT_CHILD=1` 标记的 Pi 进程，避免子 Agent 的固定 effort 污染主会话偏好。

## 安装

从 npm 安装：

```bash
pi install npm:@specode/pi-last-model-effort
```

也可以不安装，只临时试用一次：

```bash
pi -e npm:@specode/pi-last-model-effort
```

也可以直接从 GitHub 安装：

```bash
pi install git:github.com/specode/pi-last-model-effort
```

安装后重启 Pi，无需额外配置。

## 行为

| 场景 | 行为 |
| --- | --- |
| 全新的 `pi` 会话或 `/new` | 恢复最近模型及其已记忆 effort |
| 切换或循环选择模型 | 恢复目标模型最近使用的 effort |
| `pi -c`、`/resume`、fork、clone、reload | 保留目标会话自己的模型和 effort |
| 显式指定 CLI 模型或 effort | 命令行选择优先 |
| scoped model 固定了 effort | scoped effort 优先 |
| 模型不可用或缺少认证 | 保留 Pi 当前选择并显示警告 |

Pi 根据模型能力收敛后的实际档位，会成为该模型新的记忆值。

## 状态文件

状态独立于 Pi 设置和会话文件保存：

```text
~/.pi/agent/state/last-model-effort.json
```

实际位置会跟随 Pi 配置的 agent 目录。可通过 `PI_LAST_MODEL_EFFORT_STATE` 覆盖完整文件路径，主要用于测试或隔离环境。

扩展不会修改 Pi 的 `modelThinkingLevels` 设置，也不会发起网络请求。

## 兼容性

扩展仅使用 Pi 的公开扩展 API，并已在 Pi 0.84.3 上验证。按照 Pi package 的建议，`@earendil-works/pi-coding-agent` 被声明为 peer dependency。

## 开发

运行测试：

```bash
npm test
```

验证 Pi 能够加载扩展：

```bash
npm run smoke
```

## 许可证

[MIT](./LICENSE)
