"use strict";

/**
 * QLEX Universal Agent Retrieval Skill Generator (`qlex-memory`)
 *
 * Publishes a zero-dependency, self-contained Agent Skill (`SKILL.md` + `scripts/qlex_memory.mjs` + `scripts/memory-core.cjs`)
 * into every local AI agent skill directory (Agents, Codex, Claude Code, Hermes, Antigravity, DSH)
 * so ANY agent can retrieve, retain, reflect, traverse the temporal knowledge graph, and browse `qlex://` L0/L1/L2 context.
 */

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { homedir } = require("node:os");
const { SKILL_ROOTS } = require("./skill-sync");
const { ENGINE_VERSION } = require("./memory-core");

const MEMORY_SKILL_NAME = "qlex-memory";
const MEMORY_SKILL_VERSION = "2.0.0";

function buildSkillMarkdown() {
    return `---
name: qlex-memory
description: >
  QLEX 统一长期记忆与时序知识图谱检索技能。融合 Mem0（原子记忆与冲突消解）、Hindsight（Retain/Recall/Reflect 认知分区）、
  memU（Resources/Items/Categories 三层文件系统）、Cognee + Graphiti（双时态知识图谱与演进链）、OpenViking（qlex:// 虚拟上下文与 L0/L1/L2 分层加载）
  以及每日/每周/每月自动压缩归档。
  触发场景：当你需要回忆历史决策、用户偏好、项目上下文、排错经验、事实随时间的变化，或需要把重要结论沉淀为跨 Agent 持久记忆时调用。
---

# QLEX Memory — 跨 Agent 持久记忆与知识图谱技能 (v${MEMORY_SKILL_VERSION})

本技能由 **QLEX 桌面工作台**自动维护，直接读写本机统一记忆目录（默认 \`~/Documents/QLEX-Memory\`，支持通过环境变量 \`QLEX_MEMORY_DIR\` 覆盖）。

## 核心原则：OpenViking L0 → L1 → L2 渐进式检索（极致省 Token）

在检索历史记忆时，**不要一次全量加载全文**，请遵循三层渐进式工作流：

1. **先用 L0 快速扫描**（每条仅 ~1 句话摘要 + \`qlex://\` URI）：
   \`\`\`bash
   node <skill_dir>/scripts/qlex_memory.mjs recall "关键词或问题" --level L0 --limit 8
   \`\`\`
2. **命中候选后，按需读取 L1 概览或 L2 全文证据**：
   \`\`\`bash
   node <skill_dir>/scripts/qlex_memory.mjs browse qlex://items/<id> --level L2
   \`\`\`
3. **追踪事实随时间的演进（Graphiti 双时态知识图谱）**：
   \`\`\`bash
   node <skill_dir>/scripts/qlex_memory.mjs graph --entity "项目或技术名" --history
   node <skill_dir>/scripts/qlex_memory.mjs recall "架构决策" --as-of 2026-03-01 --level L1
   \`\`\`

## 常用 CLI 命令

所有命令均使用本机内置 \`node\`（零外部依赖），支持追加 \`--json\` 输出结构化 JSON 供程序解析：

| 操作 | 命令示例 | 说明 |
| --- | --- | --- |
| **检索记忆 (Recall)** | \`node <skill_dir>/scripts/qlex_memory.mjs recall "查询词" --level L1 --project myproj\` | 混合词法 + 知识图谱 1-hop 邻域召回；支持 \`--bank\`, \`--scope\`, \`--project\`, \`--as-of\`, \`--level L0\\|L1\\|L2\` |
| **写入记忆 (Retain)** | \`node <skill_dir>/scripts/qlex_memory.mjs retain "内容" --title "标题" --bank opinion --scope user --fact-key "ui-style"\` | 自动脱敏 + Mem0 冲突消解（ADD / UPDATE / SUPERSEDE / NOOP）+ 自动抽取知识图谱三元组 |
| **触发反思 (Reflect)** | \`node <skill_dir>/scripts/qlex_memory.mjs reflect\` | 基于活跃事实、经验与图谱演进链，合成 \`observation\` 与 \`mental_model\`（附证据 ID） |
| **知识图谱 (Graph)** | \`node <skill_dir>/scripts/qlex_memory.mjs graph --entity "QLEX" --history\` | 查询实体关系及 \`validFrom → validTo\` 双时态演进历史 |
| **虚拟目录 (Browse)** | \`node <skill_dir>/scripts/qlex_memory.mjs browse qlex://categories --level L0\` | 浏览 \`qlex://\`, \`qlex://categories\`, \`qlex://items\`, \`qlex://graph\`, \`qlex://reflections\`, \`qlex://daily\`, \`qlex://weekly\`, \`qlex://monthly\` |
| **周期归档 (Timeline)** | \`node <skill_dir>/scripts/qlex_memory.mjs timeline --kind daily --limit 7\` | 查看每日 / 每周 / 每月压缩记忆索引 |
| **压缩同步 (Compress)** | \`node <skill_dir>/scripts/qlex_memory.mjs compress\` | 增量采集本机 AI 日志，更新日/周/月压缩缓存、分类与知识图谱 |
| **遗忘条目 (Forget)** | \`node <skill_dir>/scripts/qlex_memory.mjs forget <mem_id> --reason "已过时"\` | 软失效指定记忆条目并同步标记关联图谱边 |
| **查看状态 (Status)** | \`node <skill_dir>/scripts/qlex_memory.mjs status\` | 查看记忆库目录、原子记忆数、实体/边数、日/周/月归档与压缩率 |

## 认知分区（Hindsight Memory Banks）选择指南

- \`world\`：客观事实、架构说明、环境路径、依赖版本
- \`experience\`：踩坑记录、Bug 根因与修复步骤、有效命令与工作流
- \`opinion\`：用户明确表达的偏好、风格品味、长期约束（如“不要用某方案”）
- \`observation\` / \`mental_model\`：由 \`reflect\` 自动合成的高层洞察与项目画像

## 何时应当主动调用 \`retain\`

- 用户明确提出长期偏好、代码/设计规范或工作流要求时（\`--bank opinion\`）
- 解决了较难的 Bug 或完成了关键架构决策时（\`--bank experience\` 或 \`--bank world\`）
- 技术选型发生变更时，请传入相同的 \`--fact-key\` 或使用“从 A 改用 B”表述，触发 Graphiti 双时态 \`SUPERSEDE\` 自动保留演进链

> **安全约束**：引擎会自动对 \`sk-*\`、\`ghp_*\`、\`Bearer\`、\`password\` 等敏感凭证做 \`[REDACTED]\` 脱敏；请勿主动写入明文密钥。
`;
}

function buildCliScript() {
    return `#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(__dirname, "memory-core.cjs"));

function parseArgs(argv) {
    const positionals = [];
    const flags = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith("--")) {
            const eq = arg.indexOf("=");
            if (eq !== -1) {
                flags[arg.slice(2, eq)] = arg.slice(eq + 1);
            } else {
                const key = arg.slice(2);
                const next = argv[i + 1];
                if (next !== undefined && !next.startsWith("--")) {
                    flags[key] = next;
                    i++;
                } else {
                    flags[key] = true;
                }
            }
        } else {
            positionals.push(arg);
        }
    }
    return { positionals, flags };
}

function printMarkdownRecall(res) {
    console.log(\`# QLEX Recall · "\${res.query || "*"}" (\${res.level}\${res.asOf ? \`, asOf \${res.asOf}\` : ""})\`);
    console.log(\`- 命中：\${res.results.length} / \${res.totalMatched}\`);
    if (!res.results.length) {
        console.log("\\n_未检索到匹配记忆。_");
    } else {
        console.log("");
        for (const r of res.results) {
            const meta = [r.bank, r.scope, r.project || null, \`score \${r.score}\`, r.status !== "active" ? r.status : null].filter(Boolean).join(" · ");
            console.log(\`- \\\`\${r.uri}\\\` **[\${meta}]** \${r.l0}\`);
            if (res.level === "L1" && r.l1 && r.l1 !== r.l0) {
                console.log(\`  \${r.l1.replace(/\\n/g, "\\n  ")}\`);
            } else if (res.level === "L2") {
                console.log(\`  \${(r.l2 || r.l1).replace(/\\n/g, "\\n  ")}\`);
                if (r.evidence?.length) console.log(\`  证据：\${r.evidence.join(", ")}\`);
            }
        }
    }
    if (res.graphContext?.length) {
        console.log("\\n## 关联知识图谱 (1-hop)");
        for (const e of res.graphContext) {
            console.log(\`- \${e.active ? "●" : "○"} \${e.subject} —[\${e.predicate}]→ \${e.object}\`);
        }
    }
}

function printHelp() {
    console.log(\`QLEX Memory CLI (v${MEMORY_SKILL_VERSION})

Usage:
  qlex_memory.mjs recall "<query>" [--level L0|L1|L2] [--bank world|experience|opinion|observation|mental_model] [--scope user|project|agent|session] [--project <name>] [--as-of YYYY-MM-DD] [--limit N] [--history] [--json]
  qlex_memory.mjs retain "<content>" [--title "..."] [--bank ...] [--scope ...] [--project ...] [--category ...] [--tags a,b] [--fact-key ...] [--supersede] [--json]
  qlex_memory.mjs reflect [--project <name>] [--json]
  qlex_memory.mjs graph [--entity <name>] [--history] [--as-of YYYY-MM-DD] [--limit N] [--json]
  qlex_memory.mjs browse [qlex://uri] [--level L0|L1|L2] [--json]
  qlex_memory.mjs timeline [--kind daily|weekly|monthly] [--limit N] [--json]
  qlex_memory.mjs compress [--json]
  qlex_memory.mjs forget <mem_id> [--reason "..."] [--hard] [--json]
  qlex_memory.mjs status [--json]
\`);
}

async function main() {
    const { positionals, flags } = parseArgs(process.argv.slice(2));
    const cmd = positionals[0] || "help";
    const asJson = Boolean(flags.json);
    const customDir = typeof flags.dir === "string" ? flags.dir : undefined;
    const engine = core.createCognitiveMemoryEngine({
        getArchiveDir: () => customDir || core.resolveDefaultMemoryDir(),
    });

    if (cmd === "help" || cmd === "-h" || cmd === "--help") {
        printHelp();
        return;
    }

    if (cmd === "status") {
        const st = engine.getStatus();
        if (asJson) return console.log(JSON.stringify(st, null, 2));
        console.log(\`# QLEX Memory Status (Engine v\${st.engineVersion})\`);
        console.log(\`- 目录：\${st.archiveDir}\`);
        console.log(\`- 活跃记忆：\${st.cognitive.activeItems} 条（历史演进替代：\${st.cognitive.supersededItems} 条）\`);
        console.log(\`- 认知分区：world=\${st.cognitive.banks.world} experience=\${st.cognitive.banks.experience} opinion=\${st.cognitive.banks.opinion} observation=\${st.cognitive.banks.observation} mental_model=\${st.cognitive.banks.mental_model}\`);
        console.log(\`- 知识图谱：\${st.cognitive.entities} 实体 · \${st.cognitive.activeEdges} 活跃边 · \${st.cognitive.historicalEdges} 历史边\`);
        console.log(\`- 周期归档：每日 \${st.counts.daily} · 每周 \${st.counts.weekly} · 每月 \${st.counts.monthly}（压缩率 \${st.compressionRatio}%）\`);
        return;
    }

    if (cmd === "recall" || cmd === "search") {
        const query = positionals.slice(1).join(" ");
        const res = engine.recall(query, {
            level: flags.level || "L1",
            bank: flags.bank,
            scope: flags.scope,
            project: flags.project,
            category: flags.category,
            asOf: flags["as-of"] || flags.asOf,
            includeSuperseded: Boolean(flags.history || flags["include-superseded"]),
            limit: flags.limit ? Number(flags.limit) : 10,
        });
        if (asJson) return console.log(JSON.stringify(res, null, 2));
        printMarkdownRecall(res);
        return;
    }

    if (cmd === "retain" || cmd === "add") {
        const content = positionals.slice(1).join(" ") || (typeof flags.content === "string" ? flags.content : "");
        let triples;
        if (typeof flags.triples === "string") {
            try { triples = JSON.parse(flags.triples); } catch { /* ignore */ }
        }
        const res = engine.retain({
            content,
            title: typeof flags.title === "string" ? flags.title : undefined,
            bank: typeof flags.bank === "string" ? flags.bank : undefined,
            scope: typeof flags.scope === "string" ? flags.scope : undefined,
            project: typeof flags.project === "string" ? flags.project : undefined,
            agent: typeof flags.agent === "string" ? flags.agent : "external-agent",
            source: typeof flags.source === "string" ? flags.source : "agent",
            category: typeof flags.category === "string" ? flags.category : undefined,
            factKey: typeof flags["fact-key"] === "string" ? flags["fact-key"] : (typeof flags.factKey === "string" ? flags.factKey : undefined),
            tags: typeof flags.tags === "string" ? flags.tags : undefined,
            confidence: flags.confidence ? Number(flags.confidence) : undefined,
            supersede: Boolean(flags.supersede),
            triples,
        });
        if (asJson) return console.log(JSON.stringify(res, null, 2));
        console.log(\`[\${res.operation}] \${res.item.uri} (\${res.item.bank}/\${res.item.scope}) — \${res.item.l0}\`);
        if (res.supersededId) console.log(\`  ↳ 替代旧记忆：qlex://items/\${res.supersededId}\`);
        console.log(\`  ↳ 图谱增量：+\${res.graphDelta.entitiesAdded} 实体 / +\${res.graphDelta.edgesAdded} 关系 / \${res.graphDelta.edgesSuperseded} 演进替代\`);
        return;
    }

    if (cmd === "reflect") {
        const res = engine.reflect({ project: typeof flags.project === "string" ? flags.project : "" });
        if (asJson) return console.log(JSON.stringify(res, null, 2));
        console.log(\`# Hindsight Reflect 完成（更新/生成 \${res.generated} 条洞察与心智模型）\`);
        for (const r of res.results) {
            console.log(\`- [\${r.operation}] \\\`\${r.item.uri}\\\` \${r.item.l0}\`);
        }
        return;
    }

    if (cmd === "graph") {
        const res = engine.graphQuery({
            entity: typeof flags.entity === "string" ? flags.entity : (positionals[1] || ""),
            includeHistory: flags.history !== undefined ? Boolean(flags.history) : true,
            asOf: flags["as-of"] || flags.asOf,
            limit: flags.limit ? Number(flags.limit) : 40,
        });
        if (asJson) return console.log(JSON.stringify(res, null, 2));
        console.log(\`# QLEX 时序知识图谱\${res.entity ? \` · \${res.entity}\` : ""}\${res.asOf ? \` (asOf \${res.asOf})\` : ""}\`);
        console.log(\`- 实体：\${res.entityCount} · 边：\${res.edgeCount}\\n\`);
        for (const e of res.edges) {
            console.log(\`- \${e.active ? "●" : "○"} **\${e.subject}** —[\\\`\${e.predicate}\\\`]→ **\${e.object}**\${e.validTo ? " (已替代)" : ""}\`);
        }
        return;
    }

    if (cmd === "browse" || cmd === "ls") {
        const uri = positionals[1] || "qlex://";
        const res = engine.browse(uri, flags.level || "L1");
        if (asJson) return console.log(JSON.stringify(res, null, 2));
        console.log(\`# Browse \${res.uri} (\${res.level})\\n\`);
        console.log(res.content);
        return;
    }

    if (cmd === "timeline") {
        const kind = ["daily", "weekly", "monthly"].includes(flags.kind) ? flags.kind : "daily";
        const res = engine.browse(\`qlex://\${kind}\`, flags.level || "L0");
        if (asJson) return console.log(JSON.stringify(res, null, 2));
        console.log(\`# QLEX Timeline · \${kind}\\n\`);
        console.log(res.content);
        return;
    }

    if (cmd === "compress") {
        const res = engine.compressSync();
        if (asJson) return console.log(JSON.stringify(res, null, 2));
        console.log(\`压缩与归档完成：\${res.archiveDir}\`);
        console.log(\`- 活跃记忆：\${res.cognitive.activeItems} · 图谱实体：\${res.cognitive.entities} · 边：\${res.cognitive.activeEdges}\`);
        console.log(\`- 归档：每日 \${res.counts.daily} · 每周 \${res.counts.weekly} · 每月 \${res.counts.monthly}（压缩率 \${res.compressionRatio}%）\`);
        return;
    }

    if (cmd === "forget") {
        const id = positionals[1];
        if (!id) throw new Error("请提供要遗忘的记忆 ID，例如：forget mem_xxxxxxxxxx");
        const res = engine.forget(id, { reason: typeof flags.reason === "string" ? flags.reason : "", hard: Boolean(flags.hard) });
        if (asJson) return console.log(JSON.stringify(res, null, 2));
        console.log(\`已处理记忆 \${res.id} (\${res.status})\`);
        return;
    }

    throw new Error(\`未知命令：\${cmd}。运行 --help 查看帮助。\`);
}

main().catch((err) => {
    console.error("qlex-memory error:", err?.message || err);
    process.exit(1);
});
`;
}

function buildSkillFiles() {
    const coreSource = fs.readFileSync(path.join(__dirname, "memory-core.js"), "utf8");
    const files = [
        { rel: "SKILL.md", content: buildSkillMarkdown(), executable: false },
        { rel: "scripts/memory-core.cjs", content: coreSource, executable: false },
        { rel: "scripts/qlex_memory.mjs", content: buildCliScript(), executable: true },
    ];
    const hash = createHash("sha256")
        .update(JSON.stringify(files.map(f => [f.rel, f.content, f.executable])))
        .digest("hex");
    return { files, hash };
}

function computeDirHash(skillDir) {
    try {
        const rels = ["SKILL.md", "scripts/memory-core.cjs", "scripts/qlex_memory.mjs"];
        const tuples = rels.map(rel => {
            const full = path.join(skillDir, ...rel.split("/"));
            const stat = fs.lstatSync(full);
            if (!stat.isFile()) return null;
            return [rel, fs.readFileSync(full, "utf8"), Boolean(stat.mode & 0o100)];
        });
        if (tuples.some(x => !x)) return null;
        return createHash("sha256").update(JSON.stringify(tuples)).digest("hex");
    } catch {
        return null;
    }
}

function installMemorySkill({ home = homedir(), namespaces = Object.keys(SKILL_ROOTS) } = {}) {
    const selected = namespaces.filter(ns => Object.hasOwn(SKILL_ROOTS, ns));
    const targets = selected.length ? selected : Object.keys(SKILL_ROOTS);
    const { files, hash } = buildSkillFiles();
    const installed = [];
    const failed = [];

    for (const ns of targets) {
        const rootDir = path.join(home, SKILL_ROOTS[ns]);
        const targetDir = path.join(rootDir, MEMORY_SKILL_NAME);
        try {
            fs.mkdirSync(rootDir, { recursive: true, mode: 0o755 });
            if (computeDirHash(targetDir) === hash) {
                installed.push({ namespace: ns, path: targetDir, status: "up-to-date" });
                continue;
            }
            const tmpDir = fs.mkdtempSync(path.join(rootDir, ".qlex-memory-skill-"));
            let backupDir = null;
            try {
                for (const f of files) {
                    const dest = path.join(tmpDir, ...f.rel.split("/"));
                    fs.mkdirSync(path.dirname(dest), { recursive: true, mode: 0o755 });
                    fs.writeFileSync(dest, f.content, { mode: f.executable ? 0o755 : 0o644 });
                }
                if (fs.existsSync(targetDir)) {
                    backupDir = path.join(rootDir, `.qlex-memory-bak-${randomUUID().slice(0, 8)}`);
                    fs.renameSync(targetDir, backupDir);
                }
                try {
                    fs.renameSync(tmpDir, targetDir);
                } catch (err) {
                    if (backupDir && fs.existsSync(backupDir)) fs.renameSync(backupDir, targetDir);
                    throw err;
                }
                if (backupDir) fs.rmSync(backupDir, { recursive: true, force: true });
                installed.push({ namespace: ns, path: targetDir, status: "installed" });
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        } catch (err) {
            failed.push({ namespace: ns, path: targetDir, error: err?.message || String(err) });
        }
    }

    return {
        skillName: MEMORY_SKILL_NAME,
        version: MEMORY_SKILL_VERSION,
        engineVersion: ENGINE_VERSION,
        hash,
        installed,
        failed,
        status: getMemorySkillStatus({ home, namespaces: targets }),
    };
}

function getMemorySkillStatus({ home = homedir(), namespaces = Object.keys(SKILL_ROOTS) } = {}) {
    const selected = namespaces.filter(ns => Object.hasOwn(SKILL_ROOTS, ns));
    const targets = selected.length ? selected : Object.keys(SKILL_ROOTS);
    const { hash } = buildSkillFiles();
    const installedNamespaces = [];
    const upToDateNamespaces = [];
    const missingNamespaces = [];
    let cliPath = "";

    for (const ns of targets) {
        const dir = path.join(home, SKILL_ROOTS[ns], MEMORY_SKILL_NAME);
        const dirHash = computeDirHash(dir);
        if (dirHash) {
            installedNamespaces.push(ns);
            if (dirHash === hash) upToDateNamespaces.push(ns);
            if (!cliPath) cliPath = path.join(dir, "scripts", "qlex_memory.mjs");
        } else {
            missingNamespaces.push(ns);
        }
    }

    return {
        skillName: MEMORY_SKILL_NAME,
        version: MEMORY_SKILL_VERSION,
        engineVersion: ENGINE_VERSION,
        installedCount: installedNamespaces.length,
        upToDateCount: upToDateNamespaces.length,
        totalCount: targets.length,
        installedNamespaces,
        upToDateNamespaces,
        missingNamespaces,
        cliPath,
    };
}

module.exports = {
    MEMORY_SKILL_NAME,
    MEMORY_SKILL_VERSION,
    buildSkillFiles,
    installMemorySkill,
    getMemorySkillStatus,
};
