#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const { createCognitiveMemoryEngine } = require(path.join(root, "desktop/src/memory-core.js"));
const { installMemorySkill, getMemorySkillStatus } = require(path.join(root, "desktop/src/memory-skill.js"));
const { createSkillSync } = require(path.join(root, "desktop/src/skill-sync.js"));

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "qlex-mem-test-"));
const memDir = path.join(tmpHome, "Documents", "QLEX-Memory");
const dataDir = path.join(tmpHome, "AppData");

try {
    // Seed mock local history.jsonl for incremental compression test
    fs.mkdirSync(path.join(tmpHome, ".codex"), { recursive: true });
    const now = Date.now();
    const yesterday = now - 86400000;
    fs.writeFileSync(path.join(tmpHome, ".codex", "history.jsonl"), [
        JSON.stringify({ timestamp: yesterday, project: "/tmp/qlex-client", display: "决定采用原生 NSVisualEffectView 毛玻璃与 Liquid Glass 实现桌面端玻璃窗口" }),
        JSON.stringify({ timestamp: now, project: "/tmp/qlex-client", display: "修复 asar 打包后 ElectronAsarIntegrity 校验失败，加入精确 SHA-256 写入 Info.plist" }),
    ].join("\n") + "\n");

    const engine = createCognitiveMemoryEngine({
        getArchiveDir: () => memDir,
        getProjects: () => [{ id: "p1", name: "qlex-client", directory: "/tmp/qlex-client" }],
        getUsageSnapshot: () => ({
            today: {
                total: 125000,
                totals: { codex: { tokens: 95000, sessions: 3 }, claude: { tokens: 30000, sessions: 1 } },
                projects: [{ name: "qlex-client", directory: "/tmp/qlex-client", tokens: 125000 }],
            },
            week: { daily: [{ date: new Date(yesterday).toISOString().slice(0, 10), tokens: 80000 }] },
            history: {},
        }),
        home: tmpHome,
    });

    // 1. Secret scrubbing + Mem0 ADD
    const t1 = Date.parse("2026-01-10T10:00:00Z");
    const dummySecret = "sk-" + "1234567890abcdefghijklmnop";
    const r1 = engine.retain({
        title: "QLEX 客户端架构决策",
        content: `QLEX 项目初期决定使用 React 实现界面，注意不要泄露 ${dummySecret} 密钥。`,
        bank: "world",
        scope: "project",
        project: "qlex-client",
        factKey: "ui_framework",
        timestamp: t1,
        triples: [{ subject: "qlex-client", subjectType: "project", predicate: "uses_framework", object: "React", objectType: "technology", factKey: "ui_framework" }],
    });
    assert.equal(r1.operation, "ADD");
    assert.ok(r1.item.l2.includes("[REDACTED]"), "Secret must be redacted");
    assert.ok(!r1.item.l2.includes("1234567890"), "Raw secret must not remain");

    // 2. Mem0 NOOP on duplicate
    const rDup = engine.retain({
        title: "QLEX 客户端架构决策",
        content: `QLEX 项目初期决定使用 React 实现界面，注意不要泄露 ${dummySecret} 密钥。`,
        bank: "world",
        scope: "project",
        project: "qlex-client",
        factKey: "ui_framework",
    });
    assert.equal(rDup.operation, "NOOP");

    // 3. Graphiti Bi-Temporal SUPERSEDE (fact evolves over time)
    const t2 = Date.parse("2026-03-15T10:00:00Z");
    const r2 = engine.retain({
        title: "QLEX 界面技术栈演进",
        content: "QLEX 从 React 改用原生 Electron HTML+CSS 液态玻璃方案，减少打包体积。",
        bank: "world",
        scope: "project",
        project: "qlex-client",
        factKey: "ui_framework",
        timestamp: t2,
        triples: [{ subject: "qlex-client", subjectType: "project", predicate: "uses_framework", object: "Electron", objectType: "technology", factKey: "ui_framework" }],
    });
    assert.equal(r2.operation, "SUPERSEDE");
    assert.equal(r2.supersededId, r1.item.id);
    assert.ok(r2.graphDelta.edgesSuperseded >= 1, "Graphiti should supersede old framework edge");

    // 4. Opinion & Experience items + UPDATE test
    const rPref = engine.retain({
        title: "交互动效偏好",
        content: "用户偏好克制的黑白极简圆角胶囊按钮与弹簧微交互，不喜欢廉价炫彩渐变。",
        bank: "opinion",
        scope: "user",
        tags: ["ui", "design"],
    });
    assert.equal(rPref.operation, "ADD");

    const rExp = engine.retain({
        title: "macOS Liquid Glass 排查经验",
        content: "修复 koffi 加载失败的方法是 asar 打包时加上 --unpack='**/node_modules/koffi/**' 并重算 ElectronAsarIntegrity。",
        bank: "experience",
        scope: "project",
        project: "qlex-client",
    });
    assert.equal(rExp.operation, "ADD");

    // 5. Graphiti Temporal Point-in-Time (`asOf`) Recall & Graph Query
    const pastRecall = engine.recall("React", { asOf: "2026-02-01", level: "L1" });
    assert.ok(pastRecall.results.some(x => x.id === r1.item.id), "Point-in-time asOf 2026-02-01 should recall React decision");

    const currentRecallL0 = engine.recall("液态玻璃 界面", { level: "L0", limit: 5 });
    assert.ok(currentRecallL0.results.length >= 1);
    assert.equal(currentRecallL0.results[0].l2, undefined, "L0 must NOT include full L2 payload");
    assert.ok(currentRecallL0.results[0].l0.length > 0);

    const graphHistory = engine.graphQuery({ entity: "qlex-client", includeHistory: true });
    assert.ok(graphHistory.edges.some(e => e.object === "React" && !e.active), "Historical superseded edge for React must exist");
    assert.ok(graphHistory.edges.some(e => e.object === "Electron" && e.active), "Active edge for Electron must exist");

    // 6. Hindsight Reflect
    const reflected = engine.reflect();
    assert.ok(reflected.generated >= 2, `Expected >=2 reflections, got ${reflected.generated}`);

    // 7. Full CompressSync (memU 3-layer + Daily/Weekly/Monthly + incremental cache)
    const comp1 = engine.compressSync();
    assert.ok(comp1.counts.daily >= 1);
    assert.ok(comp1.counts.weekly >= 1);
    assert.ok(comp1.counts.monthly >= 1);
    assert.ok(fs.existsSync(path.join(memDir, "categories", "_abstract.md")));
    assert.ok(fs.existsSync(path.join(memDir, "categories", "_overview.md")));
    assert.ok(fs.existsSync(path.join(memDir, "graph", "graph.md")));
    assert.ok(fs.existsSync(path.join(memDir, "reflections", "reflections.md")));

    // Second run hits digest cache and is strictly idempotent (no spurious supersessions)
    const comp2 = engine.compressSync();
    assert.ok(comp2.cacheHits >= 1, "Second compress should hit file cache");
    assert.equal(comp2.cognitive.supersededItems, comp1.cognitive.supersededItems, "Repeated compress must be idempotent on supersededItems");
    assert.equal(comp2.cognitive.totalItems, comp1.cognitive.totalItems, "Repeated compress must be idempotent on totalItems");
    assert.equal(comp2.cognitive.supersededItems, 1, "Exactly 1 explicit superseded item expected");

    // 8. OpenViking `qlex://` Virtual Context FS Browse
    const bRootL0 = engine.browse("qlex://", "L0");
    assert.ok(bRootL0.content.includes("活跃原子记忆"));
    const bItemL2 = engine.browse(`qlex://items/${r2.item.id}`, "L2");
    assert.ok(bItemL2.content.includes("液态玻璃"));

    // 9. Universal Agent Retrieval Skill (`qlex-memory`) Generation, Multi-Agent Install & Real CLI Execution
    const installRes = installMemorySkill({ home: tmpHome });
    assert.equal(installRes.failed.length, 0);
    assert.equal(installRes.status.installedCount, 9);
    assert.equal(installRes.status.upToDateCount, 9);

    // Ensure skill-sync.js recognizes and validates `qlex-memory` cleanly (safeFile + size limits)
    const skillSync = createSkillSync(dataDir, tmpHome);
    const inspected = skillSync.read("codex", "qlex-memory");
    assert.ok(inspected && inspected.complete, "qlex-memory must pass skill-sync.js strict security inspection");

    // 10. Skill Sync Conflict Detection, .DS_Store/LICENSE handling, and Auto-Backup Resolution
    const conflictSkillCodex = path.join(tmpHome, ".codex/skills/demo-conflict");
    const conflictSkillDsh = path.join(tmpHome, ".dsh/skills/demo-conflict");
    fs.mkdirSync(conflictSkillCodex, { recursive: true });
    fs.mkdirSync(conflictSkillDsh, { recursive: true });
    fs.writeFileSync(path.join(conflictSkillDsh, "SKILL.md"), "# Demo v1\nold content\n");
    fs.writeFileSync(path.join(conflictSkillCodex, "SKILL.md"), "# Demo v2\nnew authoritative content\n");
    fs.writeFileSync(path.join(conflictSkillCodex, "LICENSE"), "MIT License\n");
    fs.writeFileSync(path.join(conflictSkillCodex, ".DS_Store"), "junk");
    // Even if dsh was copied 30 minutes later on the same day, codex has more files (SKILL.md + LICENSE) and should be recommended
    const slightlyOlder = new Date(Date.now() - 1800_000);
    fs.utimesSync(path.join(conflictSkillCodex, "SKILL.md"), slightlyOlder, slightlyOlder);
    fs.utimesSync(path.join(conflictSkillCodex, "LICENSE"), slightlyOlder, slightlyOlder);

    const codexPkg = skillSync.read("codex", "demo-conflict");
    assert.ok(codexPkg && codexPkg.complete, ".DS_Store must be ignored and LICENSE allowed without complete=false");

    const scannedWithConflict = skillSync.scanLocal(["codex", "dsh"]);
    assert.equal(scannedWithConflict.conflicts, 1);
    assert.equal(scannedWithConflict.conflictDetails[0].name, "demo-conflict");
    assert.equal(scannedWithConflict.conflictDetails[0].recommendedNs, "codex");

    const resolved = skillSync.resolveAllConflicts("latest", ["codex", "dsh"]);
    assert.equal(resolved.resolvedCount, 1);
    assert.equal(resolved.backedUpDirs, 1);
    assert.ok(fs.existsSync(path.join(resolved.backupDir, "dsh", "demo-conflict", "SKILL.md")), "Old version must be backed up before overwrite");
    assert.equal(skillSync.scanLocal(["codex", "dsh"]).conflicts, 0, "Zero conflicts should remain after resolution");
    assert.ok(fs.readFileSync(path.join(conflictSkillDsh, "SKILL.md"), "utf8").includes("new authoritative content"));

    // Run the standalone zero-dependency CLI directly just like Codex / Claude / Hermes / Antigravity will!
    const cliPath = installRes.status.cliPath;
    const env = { ...process.env, QLEX_MEMORY_DIR: memDir };

    const cliStatus = JSON.parse(execFileSync(process.execPath, [cliPath, "status", "--json"], { env, encoding: "utf8" }));
    assert.ok(cliStatus.cognitive.activeItems >= 4);

    const cliRetain = JSON.parse(execFileSync(process.execPath, [
        cliPath, "retain", "Hermes Agent 通过 qlex-memory CLI 成功写入跨智能体经验记录",
        "--bank", "experience", "--project", "qlex-client", "--agent", "hermes", "--json",
    ], { env, encoding: "utf8" }));
    assert.equal(cliRetain.operation, "ADD");

    const cliRecall = JSON.parse(execFileSync(process.execPath, [
        cliPath, "recall", "Hermes 经验", "--level", "L0", "--json",
    ], { env, encoding: "utf8" }));
    assert.ok(cliRecall.results.some(x => x.id === cliRetain.item.id));

    const cliGraph = JSON.parse(execFileSync(process.execPath, [
        cliPath, "graph", "--entity", "qlex-client", "--history", "--json",
    ], { env, encoding: "utf8" }));
    assert.ok(cliGraph.edgeCount >= 2);

    const cliBrowse = execFileSync(process.execPath, [cliPath, "browse", "qlex://categories", "--level", "L0"], { env, encoding: "utf8" });
    assert.ok(cliBrowse.includes("qlex://categories/"));

    // ---- 7. v3.0 agentmemory-inspired upgrades: <private>, Lesson reinforcement, Token-budgeted RRF recall, expandIds, TTL autoForget, Profile & Diagnose ----
    const privRes = engine.retain({
        title: "隐私标签过滤测试",
        content: "正式环境使用 Tailscale 穿透直连，<private>内部测试密码=top-secret-999</private> 对外不可见。",
        project: "qlex-client",
        tags: ["tailscale", "security"],
    });
    assert.ok(privRes.item.l2.includes("[PRIVATE_REDACTED]"), "<private> tag block must be stripped");
    assert.ok(!privRes.item.l2.includes("top-secret-999"), "Private tag secret must never persist");
    assert.equal(privRes.item.tier, "semantic");

    // Procedural Lesson + diminishing-returns confidence reinforcement
    const l1 = engine.saveLesson({
        title: "Tailscale 大文件拉取分片步进修复",
        trigger: "同步多张 2MB PNG 时只拉取了前 4 张",
        solution: "toPull 循环按服务端实际返回 count 推进，单文件超过 8MB 自动独立分片传输",
        project: "qlex-client",
    });
    const l2 = engine.saveLesson({
        title: "Tailscale 大文件拉取分片步进修复",
        trigger: "同步多张 2MB PNG 时只拉取了前 4 张",
        solution: "toPull 循环按服务端实际返回 count 推进，单文件超过 8MB 自动独立分片传输",
        project: "qlex-client",
    });
    assert.equal(l2.operation, "NOOP");
    assert.ok(l2.item.confidence > l1.item.confidence, "Repeated lesson confirmation must reinforce confidence");
    assert.ok(l2.item.reinforcements >= 1, "Lesson reinforcement counter must increment");

    // Pre-index layer filter + token-budgeted packing + narrative + expandIds recovery
    const budgeted = engine.recall("qlex-client", { targetLayer: "lesson", level: "L2", tokenBudget: 260, format: "narrative", limit: 10 });
    assert.ok(budgeted.tokens_used <= 260 || budgeted.minimum_budget != null, "Budgeted recall must respect tokenBudget");
    assert.ok(budgeted.results.every(r => r.layer === "lesson"), "targetLayer='lesson' must return only lesson-layer items");
    assert.equal(typeof budgeted.text, "string", "Narrative format must return readable text");

    const expanded = engine.recall("", { expandIds: [l1.item.id, privRes.item.id] });
    assert.equal(expanded.results.length, 2, "expandIds must recover full L2 content without query");
    assert.ok(expanded.results.some(r => r.id === l1.item.id && r.l2.includes("8MB")));

    // Synonym query expansion ("穿透" -> matches "Tailscale")
    const synRecall = engine.recall("穿透", { level: "L0", limit: 5 });
    assert.ok(synRecall.results.some(r => r.id === privRes.item.id), "Bilingual synonym expansion must recall Tailscale note via 穿透");

    // TTL Expiry + autoForget sweep
    const ttlMem = engine.retain({
        title: "临时调试开关",
        content: "仅今日临时跳过缓存验证用于排查。",
        project: "qlex-client",
        forgetAfter: Date.now() - 5000,
    });
    const drySweep = engine.autoForget({ dryRun: true });
    assert.ok(drySweep.ttlExpired.some(x => x.id === ttlMem.item.id), "autoForget dryRun must detect TTL-expired memory");
    const realSweep = engine.autoForget({ dryRun: false });
    assert.ok(realSweep.cleanedCount >= 1, "autoForget must clean expired TTL memory");

    // Profile & Diagnose (direct + CLI)
    const prof = engine.profile({ project: "qlex-client", tokenBudget: 900 });
    assert.ok(prof.text.includes("qlex-client") && prof.tokens_used <= 920);
    const diag = engine.diagnose();
    assert.equal(diag.engineVersion, "3.0.0");
    assert.ok(diag.healthScore >= 40 && diag.cognitive.temperatures.hot >= 1);

    const cliDiag = JSON.parse(execFileSync(process.execPath, [cliPath, "diagnose", "--json"], { env, encoding: "utf8" }));
    assert.equal(cliDiag.engineVersion, "3.0.0");
    const cliProf = JSON.parse(execFileSync(process.execPath, [cliPath, "profile", "--project", "qlex-client", "--budget", "900", "--json"], { env, encoding: "utf8" }));
    assert.ok(cliProf.counts.lessons >= 1);

    console.log("ALL QLEX v3.0 COGNITIVE MEMORY & AGENT SKILL TESTS PASSED!", JSON.stringify({
        engineVersion: diag.engineVersion,
        activeItems: diag.cognitive.activeItems,
        supersededItems: diag.cognitive.supersededItems,
        temperatures: diag.cognitive.temperatures,
        tiers: diag.cognitive.tiers,
        entities: diag.cognitive.entities,
        activeEdges: diag.cognitive.activeEdges,
        historicalEdges: diag.cognitive.historicalEdges,
        dailyWeeklyMonthly: comp2.counts,
        compressionRatio: comp2.compressionRatio,
        installedAgentDirs: installRes.status.installedCount,
    }));
} finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
}
