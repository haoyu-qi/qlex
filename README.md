# WorkContext

**换一个会话、Agent 或设备，工作也能接着做。**

WorkContext 把分散在 Codex、Claude Code、Hermes、DeepSeek Harness 和 Antigravity 里的工作记录汇到你自己的 Mac mini。下次接手同一个项目时，你可以找回当时的决定、验证结果和已经跑通的方法，并沿着引用读到原始记录。

## 它能帮你做什么

| 场景 | 你可以怎么用 |
| --- | --- |
| 接续项目 | 在 Hermes、MCP 或网页工作台按项目找回决定、任务摘要和来源记录，核对上次停在哪里。 |
| 复用经验 | 把已验证的方法存成 `experience`，写清适用条件、步骤和验证结果。后续可以单独检索经验，修订时仍保留历史版本。 |
| 回看一天的工作 | 按北京时间列出已归档的会话和记录，检查当日覆盖范围。也可以离线查看 MacBook 已采集的记录。 |
| 跨设备执行 | 把有明确权限的任务交给符合系统、工作区和能力要求的节点，并查看执行状态和验证结果。 |

例如，在处理采集端断线时，用下面的参数查找以前已经验证过的重试方法。

```json
{"query":"断线重试","project":"workcontext","kind":"experience"}
```

MCP 工具名是 `workcontext_memory.search`。Mini 上的原生 Hermes 工具接受相同参数，网页工作台也提供项目和类型筛选。打开一条记忆可以继续查看它引用的来源。

## 从两台设备开始

- **MacBook** 是日常工作入口。Relay 只采集已授权目录的记录，离线时先写入本机队列，收到 Mini 的持久化回执后才确认送达。
- **Mac mini** 保存原始记录和带版本的记忆笔记，提供 Hermes 自动召回、MCP 和浏览器工作台。网页可以用一次性配对码连接，服务凭证保留在部署端。
- **Obsidian** 保存你可以直接编辑的原文和日报。WorkContext 在 Mini 存摘要和原文引用，Obsidian 文件在两台设备间继续由现有同步插件处理。

需要跑 Windows 专属任务时，再按能力登记 Windows 节点。也可以通过校验清单将选定的操作技能分发到不同节点。

## 开始使用

需要 Python 3.9 或更新版本。从 GitHub Releases 下载 wheel 后安装，也可以在仓库根目录运行 `python -m pip install .`。

```sh
python -m pip install ./workcontext_services-0.4.1-py3-none-any.whl
workcontext selfcheck
workcontext --help
```

仓库提供示例配置和 Hermes 插件。按使用场景选择部署入口。

- [配置 Mini 记忆服务、MacBook Relay 和 Hermes](public-docs/LONG-TERM-MEMORY.md)
- [打开浏览器工作台、设置设备配对](public-docs/OPERATIONS.md#browser-console)
- [配置跨设备执行和技能分发](public-docs/OPERATIONS.md)
- [了解服务架构、数据范围和权限](public-docs/ARCHITECTURE.md)

工作记忆借鉴了 Hy Memory 对工作事实和可复用经验的区分。WorkContext 使用本地 SQLite 和关键词召回，经验由助手根据已核对的结果显式保存。 [Hy Memory Working 与 Coding 设计](https://github.com/Tencent-Hunyuan/Hy-Memory/blob/23cb604ec4e27b69905a361cb38553e1c350480d/docs/scene_coding_usage.md)
