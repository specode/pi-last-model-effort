# pi-last-model-effort

[English](./README.md) | [简体中文](./README.zh-CN.md)

一个 [Pi](https://github.com/earendil-works/pi-mono) 扩展：记住每个模型上次使用的推理档位（thinking effort），并在新开的 TUI 会话中恢复上次使用的模型和档位。

## 安装

需要支持 `ExtensionContext.mode` 的 Pi 版本（已用 Pi 1.4.0 测试）。

从 npm 安装：

```bash
pi install npm:@specode/pi-last-model-effort
```

从 GitHub 安装：

```bash
pi install git:github.com/specode/pi-last-model-effort
```

从本地目录安装（开发调试）：

```bash
pi install /path/to/pi-last-model-effort
```

安装后重启 Pi 生效。

## 使用说明

无需配置。安装后：

- 在某个模型下调整推理档位时，会按 `provider/model` 记录该档位。
- 切换到其他模型再切回时，自动恢复该模型上次记录的推理档位。
- 新开 `pi` TUI 会话或执行 `/new` 时，自动恢复最近一次选择的模型及其推理档位。
- 如果记录的档位超出目标模型支持范围，Pi 会通过 `setThinkingLevel()` 收敛到可用档位并更新记录。

### 生效与优先级规则

| 场景 | 行为 |
| --- | --- |
| 全新 TUI `pi` 会话或 `/new` | 恢复最近一次选择的模型及其记录的推理档位 |
| 会话中切换或循环选择模型 | 恢复目标模型记录的推理档位 |
| `pi -c`、`/resume`、fork、clone、`/reload` | 保持该会话原有的模型与档位不变 |
| 命令行参数（`--model`、`--provider`、`--thinking`、带 `:thinking` 的 `--models`） | 命令行参数优先 |
| Scoped model（`--models` / `enabledModels`）固定了档位 | 固定的 scoped 档位优先 |
| 非 TUI 模式（`rpc`、`json`、`print`）或 `PI_SUBAGENT_CHILD=1` | 跳过，不读取、恢复或写入状态 |
| 记录的模型不可用或未登录凭据 | 保持 Pi 当前选择并提示警告 |

## 配置

状态保存在 `~/.pi/agent/state/last-model-effort.json`（跟随 Pi 配置的 Agent 目录）。在测试或隔离环境中，可通过环境变量 `PI_LAST_MODEL_EFFORT_STATE` 指定自定义状态文件路径。

## 隐私与安全

- 不发起任何网络请求，不读取任何凭据。
- 不修改 `settings.json`、`modelThinkingLevels` 或会话记录文件。
- 仅在 `ctx.mode === "tui"` 时运行，并忽略带有 `PI_SUBAGENT_CHILD=1` 的子进程，非交互调用和子代理不会覆盖主会话偏好。
- 状态写入使用文件锁、按时间戳合并和原子替换（权限 `0600`），同时打开多个 Pi 终端不会损坏状态文件。

## 本地开发

```bash
# 运行测试（需要原生支持 TypeScript 的 Node.js 版本）
npm test

# 检查打包文件列表
npm run pack:check

# 不安装直接加载扩展验证
pi --no-extensions --offline -e ./src/index.ts --list-models
```

## 许可证

[MIT](./LICENSE)。
