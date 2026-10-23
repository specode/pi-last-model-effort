# pi-last-model-effort

[English](./README.md) | [简体中文](./README.zh-CN.md)

为 [Pi](https://github.com/earendil-works/pi-mono) 自动记住每个模型上次使用的推理档位（thinking / reasoning effort）——在不同模型间来回切换或开启新会话时，无需再每次手动重调。

- **按模型独立记忆**：为每个 `provider/model` 独立保存最近一次实际生效的推理档位。
- **新会话自动恢复**：打开全新的 `pi` 终端或执行 `/new` 时，自动恢复到上次使用的模型及对应档位。
- **不干扰显式指定**：完整保留历史会话恢复（`pi -c`、`/resume`）、命令行参数（`--model`、`--thinking`）及 scoped model 的固定档位优先级。
- **零配置即装即用**：安装后完全无感运行，无需修改任何配置文件。

---

## 前置依赖

- 已安装支持 `ExtensionContext.mode` 的 [Pi](https://github.com/earendil-works/pi-mono)（已在 Pi `1.4.0` 验证）。插件仅在 TUI 模式启用，RPC、JSON、print 及未知模式均跳过。

---

## 安装

从 npm 安装：

```bash
pi install npm:@specode/pi-last-model-effort
```

或从 GitHub 安装：

```bash
pi install git:github.com/specode/pi-last-model-effort
```

单次免安装体验：

```bash
pi -e npm:@specode/pi-last-model-effort
```

安装完成后重启 Pi 即可生效，无需任何额外配置。

---

## 快速开始

安装后按平时习惯切换模型与推理档位即可：

1. 选择模型 A，将其推理档位调为 `high`。
2. 切换到模型 B，将档位调为 `low`。
3. 再次切回模型 A —— 推理档位会自动恢复为 `high`。
4. 新开一个终端运行 `pi` —— 自动沿用你最后一次使用的模型与档位。

---

## 工作原理与设计思路

### 触发场景与优先级规则

不同模型往往适合不同的推理强度，但盲目覆盖又会打乱用户的临时指定或历史会话恢复。为此，插件设计了明确的优先级边界：

| 场景 | 行为 |
| --- | --- |
| **非 TUI 模式（RPC、JSON、print）** | 不读取、恢复或写入偏好 |
| **全新 TUI `pi` 会话或 `/new`** | 恢复最近一次选择的模型及其记忆的推理档位 |
| **会话中切换或循环选择模型** | 自动恢复目标模型上次使用的推理档位 |
| **`pi -c`、`/resume`、fork、clone、`/reload`** | 保持目标历史会话原有的模型与档位不变 |
| **命令行显式传参（`--model`、`--provider`、`--thinking`）** | 命令行参数优先 |
| **Scoped model（`--models` / `enabledModels`）固定了档位** | 固定的 scoped 档位优先 |
| **目标模型不可用或未登录凭据** | 保持 Pi 当前选择并给出警告提示 |

### 能力收敛、子进程隔离与并发安全

- **原生档位安全收敛**：通过调用 Pi 原生的 `setThinkingLevel()` 恢复档位；若某档位超出模型支持范围，会由 Pi 自动收敛到模型支持的有效档位，并将收敛后的结果作为新的记忆值。
- **仅 TUI 模式启用**：所有生命周期处理器均要求 `ctx.mode === "tui"`；非交互进程即使没有子代理标记，也不会参与偏好记忆。
- **子 Agent 进程隔离**：自动忽略带有 `PI_SUBAGENT_CHILD=1` 环境变量的子进程，防止子 Agent 的固定推理档位污染主会话偏好。
- **多终端并发安全**：状态写入采用文件锁、时间戳对比合并与原子文件替换，同时打开多个 Pi 终端也不会互相覆盖或损坏状态。

### 状态存储位置

偏好数据独立保存在以下状态文件中，不会污染你的 `settings.json`、`modelThinkingLevels` 配置或会话记录，也不会发起任何网络请求：

```text
~/.pi/agent/state/last-model-effort.json
```

存储目录自动跟随 Pi 配置的 Agent 目录。在测试或隔离环境中，可通过环境变量 `PI_LAST_MODEL_EFFORT_STATE` 指定自定义文件路径。

---

## 本地开发

```bash
# 运行单元测试
npm test

# 验证 Pi 能够正常加载扩展
npm run smoke
```

## 许可证

[MIT](./LICENSE)
