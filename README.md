# QLEX

**多端 AI 工作台互联中枢：换一台设备、换一个 Agent，你的记忆、项目与技能始终在线。**

QLEX（原 WorkContext）把分散在 **Codex、Claude Code、Antigravity、Hermes、DeepSeek Harness（DSH）** 等本机 AI 工具中的工作记忆、项目目录和本地 Skills 统一组织起来，通过 **中心点 / 接入点** 双向同步与内嵌 **Tailscale（tsnet）** 内网穿透，实现跨设备无缝接续。

## 核心能力

| 模块 | 说明 |
| --- | --- |
| **中心点与接入点** | 一台设备（如 Mac mini）设为中心点，其余设备（如 MacBook）通过一次性邀请码接入，支持审批、吊销、心跳保活与自签 TLS 加密传输。 |
| **双向记忆同步与认知引擎** | 融合原子记忆消解、双时态知识图谱、L0/L1/L2 分层上下文（`qlex://`）与日 / 周 / 月自动压缩归档（`~/Documents/QLEX-Memory`），支持中心点与接入点增量双向同步。 |
| **跨 Agent 检索技能（`qlex-memory`）** | 自动向本机 6 大 AI 工具技能目录分发通用检索技能，任意 Agent 均可通过统一 CLI 检索、写入与反思历史工作记忆。 |
| **跨端项目同步** | 中心点与接入点共享工作区清单，新设备一键绑定本机目录，保持项目标识跨端对齐。 |
| **本地 Skills 同步与冲突解决** | 跨多款本地 AI 工具自动对齐 Skills 目录，发现同名版本冲突时支持一键合并、按最新覆盖并自动备份到 `~/.qlex-skill-backups`。 |
| **内网穿透与自动发现** | 集成系统 Tailscale 检测、内嵌 Go `tailscale.com/tsnet` SDK Sidecar 及局域网 UDP 广播，自动发现中心节点。 |
| **macOS 菜单栏状态面板 & 侧边吸附** | 点击菜单栏 QLEX 图标展开模块化毛玻璃状态面板（节点状态、双向同步、记忆、项目、穿透、Skills、跨 Agent 覆盖环与快捷操作），右键打开快捷菜单；亦支持屏幕侧边悬浮吸附。 |
| **双通道自动更新** | 支持 `Beta` / `Stable` 双通道检测、进度下载与强制 SHA-256 校验，从 GitHub Releases 自动获取新版本。 |

## 安装与使用（QLEX 桌面客户端）

### 方式一：直接下载安装包（推荐，macOS Apple Silicon）

前往 [GitHub Releases](https://github.com/haoyu-qi/qlex/releases) 下载最新版本的 `.pkg` 安装包或 `.zip` 压缩包（附 `SHA256SUMS.txt` 校验文件）：

- **Beta 通道**：获取最新功能与体验改进（含 Pre-release）
- **Stable 通道**：仅接收正式稳定版更新

### 方式二：从源码运行与构建

```sh
cd qlex-client
npm install
npm start

# 运行测试套件
node scripts/test-memory-framework.mjs
node scripts/test-v020-features.mjs

# 打包 macOS arm64 安装包（.app / .zip / .pkg）
bash scripts/build-macos-app.sh
```

## 服务端与 CLI 套件（Python）

仓库同时保留服务端与 CLI 伴随套件（Python 3.9+，兼容保留 `workcontext` 模块导入与命令名，新增 `qlex` 命令入口），可用于无界面服务器部署、Relay 采集、MCP 记忆服务与受控技能分发：

```sh
python -m pip install .
qlex selfcheck
qlex --help
```

## 相关文档

- [QLEX 桌面端与记忆架构设计](public-docs/QLEX-ARCHITECTURE.md)
- [QLEX 版本规划与迭代记录](public-docs/QLEX-NEXT-VERSION-PLAN.md)
- [长期记忆与跨端 Relay 部署说明](public-docs/LONG-TERM-MEMORY.md)
- [服务端运维、浏览器控制台与技能分发](public-docs/OPERATIONS.md)
- [整体服务架构与边界说明](public-docs/ARCHITECTURE.md)
