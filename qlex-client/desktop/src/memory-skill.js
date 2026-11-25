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
const MEMORY_SKILL_VERSION = "3.0.0";

function buildSkillMarkdown() {
    return `---
name: qlex-memory
description: >
  QLEX 统一长期记忆与时序知识图谱检索技能 (v3.0 · 融合 agentmemory 架构)。
  具备 3 路混合 RRF 检索（Okapi BM25 + 2-hop 有界知识图谱 BFS + Ebbinghaus 艾宾浩斯遗忘衰减与访问强化）、
  4 层记忆固化（working/episodic/semantic/procedural）、Token 预算精确裁剪与 expandIds 按需展开、
  过程教训强化 (lesson)、TTL 过期与冲突自检 (auto-forget)、SessionStart 项目画像 (profile) 及 <private> 隐私过滤。
  触发场景：当你需要回忆历史决策、用户偏好、项目上下文、排错经验、事实随时间的变化，或需要把重要结论沉淀为跨 Agent 持久记忆时调用。
---

# QLEX Memory — 跨 Agent 持久记忆与知识图谱技能 (v${MEMORY_SKILL_VERSION})

本技能由 **QLEX 桌面工作台**自动维护，直接读写本机统一记忆目录（默认 \`~/Documents/QLEX-Memory\`，支持通过环境变量 \`QLEX_MEMORY_DIR\` 覆盖）。

## 核心工作流：SessionStart 画像 + Token 预算 RRF 召回 + 按需展开

1. **会话开始先拉取项目画像**（按 Token 预算一次注入热记忆、教训与核心实体）：
   \`\`\`bash
   node <skill_dir>/scripts/qlex_memory.mjs profile --project myproj --budget 900
   \`\`\`
2. **用 RRF 混合检索 + Token 预算扫描**（支持 \`--layer memory|observation|lesson|all\` 与 \`--budget 800\`）：
   \`\`\`bash
   node <skill_dir>/scripts/qlex_memory.mjs recall "关键词或问题" --level L1 --layer memory --budget 800 --format narrative
   \`\`\`
3. **如返回 \`content_truncated: true\` 或 \`excluded_results\`，按 ID 精准展开 L2 全文**：
   \`\`\`bash
   node <skill_dir>/scripts/qlex_memory.mjs recall --expand mem_xxx,mem_yyy --json
   \`\`\`
4. **追踪事实随时间的演进（Graphiti 双时态知识图谱）**：
   \`\`\`bash
   node <skill_dir>/scripts/qlex_memory.mjs graph --entity "项目或技术名" --history
   node <skill_dir>/scripts/qlex_memory.mjs recall "架构决策" --as-of 2026-03-01 --level L1
   \`\`\`

## 常用 CLI 命令

所有命令均使用本机内置 \`node\`（零外部依赖），支持追加 \`--json\` 输出结构化 JSON 供程序解析：

| 操作 | 命令示例 | 说明 |
| --- | --- | --- |
| **混合检索 (Recall)** | \`node <skill_dir>/scripts/qlex_memory.mjs recall "查询词" --level L1 --layer memory --budget 800\` | Okapi BM25 + 2-hop 图谱 BFS + Ebbinghaus RRF 融合；支持 \`--expand\`, \`--format compact\\|narrative\\|full\`, \`--as-of\` |
| **项目画像 (Profile)** | \`node <skill_dir>/scripts/qlex_memory.mjs profile --project myproj --budget 1200\` | 生成 SessionStart 精简上下文画像（用户偏好、高频教训、活跃决策与核心实体） |
| **写入记忆 (Retain)** | \`node <skill_dir>/scripts/qlex_memory.mjs retain "内容" --title "标题" --bank opinion --ttl-days 30\` | 自动脱敏（含 \`<private>\` 标签）+ 冲突消解 + \`similarTo\` 相似提示 + TTL 过期 |
| **过程教训 (Lesson)** | \`node <skill_dir>/scripts/qlex_memory.mjs lesson "解决方案" --trigger "触发问题" --project myproj\` | 保存或强化可复用排错教训（重复确认自动按边际递减提升置信度） |
| **触发反思 (Reflect)** | \`node <skill_dir>/scripts/qlex_memory.mjs reflect\` | 基于经校验的活跃证据合成 \`observation\` 与 \`mental_model\`（\`evidenceVersion: 1\`） |
| **过期与冲突清理 (Auto-Forget)** | \`node <skill_dir>/scripts/qlex_memory.mjs auto-forget [--dry-run]\` | 清理超期 TTL 记忆、归档长期休眠工作记忆并报告潜在冲突对 |
| **健康诊断 (Diagnose)** | \`node <skill_dir>/scripts/qlex_memory.mjs diagnose\` | 输出健康分、热/温/冷/休眠分布、4 层固化统计与优化建议 |
| **知识图谱 (Graph)** | \`node <skill_dir>/scripts/qlex_memory.mjs graph --entity "QLEX" --history\` | 查询实体关系及 \`validFrom → validTo\` 双时态演进历史 |
| **虚拟目录 (Browse)** | \`node <skill_dir>/scripts/qlex_memory.mjs browse qlex://categories --level L0\` | 浏览 \`qlex://\` 分层虚拟文件系统 |
| **遗忘条目 (Forget)** | \`node <skill_dir>/scripts/qlex_memory.mjs forget <mem_id> --reason "已过时"\` | 软失效指定记忆条目并同步标记关联图谱边 |
| **查看状态 (Status)** | \`node <skill_dir>/scripts/qlex_memory.mjs status\` | 查看引擎版本、热/温/冷/休眠记忆统计、图谱与压缩率 |

> **安全约束**：引擎会自动剥离 \`<private>...</private>\` 隐私块以及 \`sk-*\`、\`ghp_*\`、\`Bearer\`、\`password\` 等敏感凭证；请勿主动写入明文密钥。
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
  qlex_memory.mjs recall "<query>" [--level L0|L1|L2] [--layer all|memory|observation|lesson] [--format full|compact|narrative] [--budget N] [--expand id1,id2] [--bank ...] [--scope ...] [--project <name>] [--as-of YYYY-MM-DD] [--limit N] [--history] [--json]
  qlex_memory.mjs retain "<content>" [--title "..."] [--bank ...] [--tier working|episodic|semantic|procedural] [--scope ...] [--project ...] [--category ...] [--tags a,b] [--fact-key ...] [--ttl-days N] [--supersede] [--json]
  qlex_memory.mjs lesson "<solution>" [--trigger "..."] [--title "..."] [--project <name>] [--tags a,b] [--json]
  qlex_memory.mjs profile [--project <name>] [--budget 1200] [--json]
  qlex_memory.mjs auto-forget [--dry-run] [--json]
  qlex_memory.mjs diagnose [--json]
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
            targetLayer: flags.layer || flags["target-layer"] || "all",
            format: flags.format || "full",
            tokenBudget: flags.budget ? Number(flags.budget) : (flags["token-budget"] ? Number(flags["token-budget"]) : 0),
            expandIds: flags.expand || flags["expand-ids"],
            bank: flags.bank,
            tier: flags.tier,
            scope: flags.scope,
            project: flags.project,
            agentId: flags.agent || flags["agent-id"],
            category: flags.category,
            asOf: flags["as-of"] || flags.asOf,
            includeSuperseded: Boolean(flags.history || flags["include-superseded"]),
            limit: flags.limit ? Number(flags.limit) : 10,
        });
        if (asJson) return console.log(JSON.stringify(res, null, 2));
        if (res.text) {
            console.log(res.text);
            if (res.excluded_by_budget > 0) console.log(\`\\n[budget] tokens=\${res.tokens_used}/\${res.token_budget}, excluded=\${res.excluded_by_budget}: \${res.excluded_results.map(x => x.id).join(", ")}\`);
            return;
        }
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
            tier: typeof flags.tier === "string" ? flags.tier : undefined,
            scope: typeof flags.scope === "string" ? flags.scope : undefined,
            project: typeof flags.project === "string" ? flags.project : undefined,
            agent: typeof flags.agent === "string" ? flags.agent : "external-agent",
            source: typeof flags.source === "string" ? flags.source : "agent",
            category: typeof flags.category === "string" ? flags.category : undefined,
            factKey: typeof flags["fact-key"] === "string" ? flags["fact-key"] : (typeof flags.factKey === "string" ? flags.factKey : undefined),
            ttlDays: flags["ttl-days"] ? Number(flags["ttl-days"]) : undefined,
            tags: typeof flags.tags === "string" ? flags.tags : undefined,
            confidence: flags.confidence ? Number(flags.confidence) : undefined,
            supersede: Boolean(flags.supersede),
            triples,
        });
        if (asJson) return console.log(JSON.stringify(res, null, 2));
        console.log(\`[\${res.operation}] \${res.item.uri} (\${res.item.bank}/\${res.item.tier}/\${res.item.scope}) — \${res.item.l0}\`);
        if (res.supersededId) console.log(\`  ↳ 替代旧记忆：qlex://items/\${res.supersededId}\`);
        if (res.similarTo?.length) console.log(\`  ↳ 相似提示：\${res.similarTo.map(s => \`\${s.id}(\${s.similarity})\`).join(", ")}\`);
        console.log(\`  ↳ 图谱增量：+\${res.graphDelta.entitiesAdded} 实体 / +\${res.graphDelta.edgesAdded} 关系 / \${res.graphDelta.edgesSuperseded} 演进替代\`);
        return;
    }

    if (cmd === "lesson") {
        const solution = positionals.slice(1).join(" ") || (typeof flags.solution === "string" ? flags.solution : "");
        const res = engine.saveLesson({
            title: typeof flags.title === "string" ? flags.title : undefined,
            trigger: typeof flags.trigger === "string" ? flags.trigger : "",
            solution,
            project: typeof flags.project === "string" ? flags.project : undefined,
            tags: typeof flags.tags === "string" ? flags.tags : undefined,
        });
        if (asJson) return console.log(JSON.stringify(res, null, 2));
        console.log(\`[LESSON:\${res.operation}] \${res.item.uri} (conf \${Math.round((res.item.confidence ?? 0.85) * 100)}%, reinforce \${res.item.reinforcements || 0}) — \${res.item.l0}\`);
        return;
    }

    if (cmd === "profile") {
        const res = engine.profile({
            project: typeof flags.project === "string" ? flags.project : (positionals[1] || ""),
            tokenBudget: flags.budget ? Number(flags.budget) : 1200,
        });
        if (asJson) return console.log(JSON.stringify(res, null, 2));
        console.log(res.text);
        return;
    }

    if (cmd === "auto-forget") {
        const res = engine.autoForget({ dryRun: Boolean(flags["dry-run"] || flags.dryRun) });
        if (asJson) return console.log(JSON.stringify(res, null, 2));
        console.log(\`Auto-Forget (\${res.dryRun ? "dry-run" : "applied"}): TTL过期=\${res.ttlExpired.length}, 休眠清理=\${res.dormantEvicted.length}, 潜在冲突=\${res.contradictions.length}\`);
        return;
    }

    if (cmd === "diagnose") {
        const res = engine.diagnose();
        if (asJson) return console.log(JSON.stringify(res, null, 2));
        console.log(\`# QLEX Memory Diagnose (v\${res.engineVersion}) · 健康分 \${res.healthScore}\`);
        console.log(\`- 温度分布：热=\${res.cognitive.temperatures.hot} 温=\${res.cognitive.temperatures.warm} 冷=\${res.cognitive.temperatures.cold} 休眠=\${res.cognitive.temperatures.dormant}\`);
        console.log(\`- 4层固化：working=\${res.cognitive.tiers.working} episodic=\${res.cognitive.tiers.episodic} semantic=\${res.cognitive.tiers.semantic} procedural=\${res.cognitive.tiers.procedural}\`);
        for (const r of res.recommendations) console.log(\`- \${r}\`);
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
        .update(JSON.stringify(files.map(f => [f.rel, f.content])))
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
            return [rel, fs.readFileSync(full, "utf8")];
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
