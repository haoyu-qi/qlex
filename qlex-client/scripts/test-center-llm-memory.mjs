#!/usr/bin/env node
/**
 * End-to-End Integration Test for QLEX Center LLM Memory Consolidation & Multi-Endpoint Convergence:
 *  1. Time-slot & interval scheduler evaluation + sleep/wake catch-up + anti-duplicate guard
 *  2. LocalStore LLM config persistence, "__KEEP__" secret preservation, and public API key masking
 *  3. Live local mock OpenAI-compatible LLM server + Center <-> Endpoint A <-> Endpoint B full convergence:
 *     - Endpoint A & B push duplicate, conflicting, and noisy memories to Center
 *     - Center runs LLM consolidation (merges + supersedes + prunes + syntheses + revision bump)
 *     - Center distributes canonical bundle -> Endpoint A & B converge to the exact same active memories
 *  4. onlyWhenChanged token-saving skip + graceful fallback to rule consolidation on LLM outage
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const { LocalStore } = require(path.join(root, "desktop/src/state.js"));
const { DevicePairing } = require(path.join(root, "desktop/src/pairing.js"));
const { createMemoryArchiver } = require(path.join(root, "desktop/src/memory-archive.js"));
const { createCognitiveMemoryEngine } = require(path.join(root, "desktop/src/memory-core.js"));
const {
    normalizeTimeSlots,
    publicMemoryLlmConfig,
    evaluateConsolidationSchedule,
    extractJsonObject,
    buildConsolidationBatches,
    testMemoryLlmConnection,
} = require(path.join(root, "desktop/src/memory-consolidator.js"));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qlex-center-llm-test-"));

let llmCalls = 0;
let llmFailNext = false;
let lastPromptData = null;

// Local mock OpenAI-compatible LLM server
const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", c => chunks.push(c));
    req.on("end", () => {
        llmCalls++;
        if (llmFailNext) {
            llmFailNext = false;
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: { message: "Simulated upstream outage" } }));
            return;
        }
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const userMsg = body.messages?.find(m => m.role === "user")?.content || "";

        // Ping / connectivity check
        if (userMsg.includes("请回复 ready")) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                model: body.model || "mock-llm",
                choices: [{ message: { content: JSON.stringify({ ok: true, reply: "ready" }) } }],
                usage: { prompt_tokens: 20, completion_tokens: 8 },
            }));
            return;
        }

        // Consolidation request
        const parsedInput = JSON.parse(userMsg);
        lastPromptData = parsedInput;
        const mems = parsedInput.memories || [];
        const dupA = mems.find(m => m.title.includes("Tailscale 组网方案"));
        const dupB = mems.find(m => m.title.includes("Tailscale 内网穿透配置"));
        const oldDec = mems.find(m => m.title.includes("旧方案：SQLite"));
        const newDec = mems.find(m => m.title.includes("新方案：gzip"));
        const noise = mems.find(m => m.title.includes("临时测试杂音"));

        const plan = {
            summary: "已合并 MacBook 与 WindowsPC 的 Tailscale 重复记录，确认采用 gzip 压缩存储替代 SQLite，并清理 1 条临时测试杂音。",
            merges: (dupA && dupB) ? [{
                sourceIds: [dupA.id, dupB.id],
                title: "QLEX 跨端组网采用内嵌 Tailscale tsnet 穿透方案",
                bank: "world",
                project: "qlex",
                factKey: "qlex:networking:tailscale",
                l0: "QLEX 全端统一采用内嵌 Tailscale tsnet 穿透与 MagicDNS 互联中心点。",
                l1: "1. MacBook 与 WindowsPC 均通过 tsnet 侧车直连中心点；\n2. 优先使用 MagicDNS 域名与 100.x Tailnet IP。",
                l2: "经多端验证，QLEX 统一采用内嵌 Tailscale tsnet 侧车实现免配置 NAT 穿透，中心点优先发布 MagicDNS 域名和 Tailnet IP，MacBook 与 WindowsPC 均可稳定双向同步。",
                tags: ["tailscale", "networking"],
                confidence: 0.95,
            }] : [],
            supersedes: (oldDec && newDec) ? [{
                supersededId: oldDec.id,
                winnerId: newDec.id,
                reason: "新架构决策已采用本地 gzip JSON 替代 SQLite",
            }] : [],
            prunes: noise ? [{
                id: noise.id,
                reason: "一次性临时测试信息，无长期复用价值",
            }] : [],
            syntheses: [{
                title: "QLEX 项目全端统一架构心智模型",
                bank: "mental_model",
                project: "qlex",
                factKey: "center:project:qlex",
                l0: "QLEX 架构：Tailscale tsnet 穿透 + 中心大模型整理记忆 + gzip 零依赖存储。",
                l1: "- 组网：tsnet + MagicDNS\n- 存储：零依赖 gzip JSON\n- 记忆：中心按时间段大模型整合后全端共享",
                l2: "QLEX 采用中心点权威整理模式：各接入点采集本地记忆并推至中心，中心点按时间段调用大模型合并去重、演进替代并淘汰噪音，形成唯一一份权威记忆同步给所有端。",
                evidenceIds: [newDec?.id].filter(Boolean),
                tags: ["architecture", "canonical"],
            }],
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            model: body.model || "mock-llm",
            choices: [{ message: { content: JSON.stringify(plan) } }],
            usage: { prompt_tokens: 420, completion_tokens: 210 },
        }));
    });
});

try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const mockBaseUrl = `http://127.0.0.1:${port}/v1`;

    // ---- 1. Scheduler & Time-Slot Tests ----
    assert.deepEqual(normalizeTimeSlots("21:30, 9:05, 12:30, 12:30, invalid, 25:00"), ["09:05", "12:30", "21:30"]);

    const morning = new Date(2026, 10, 27, 10, 0, 0).getTime();
    const afternoon = new Date(2026, 10, 27, 13, 15, 0).getTime();
    const evening = new Date(2026, 10, 27, 22, 0, 0).getTime();

    const schedCfg = { enabled: true, scheduleMode: "slots", timeSlots: ["12:30", "18:30", "21:30"], lastSlotKey: "" };
    assert.equal(evaluateConsolidationSchedule(schedCfg, morning).due, false, "Before first slot must not fire");
    const dueNoon = evaluateConsolidationSchedule(schedCfg, afternoon);
    assert.equal(dueNoon.due, true, "Past 12:30 slot must fire (catch-up)");
    assert.equal(dueNoon.slotKey, "2026-11-27@12:30");

    const afterNoonCfg = { ...schedCfg, lastSlotKey: dueNoon.slotKey };
    assert.equal(evaluateConsolidationSchedule(afterNoonCfg, afternoon).due, false, "Same slot must not fire twice");

    const dueNight = evaluateConsolidationSchedule(afterNoonCfg, evening);
    assert.equal(dueNight.due, true, "Evening 21:30 slot must catch up after sleep");
    assert.equal(dueNight.slotKey, "2026-11-27@21:30");

    const intervalCfg = { enabled: true, scheduleMode: "interval", intervalHours: 4, lastConsolidatedAt: evening - 5 * 3_600_000, lastSlotKey: "" };
    assert.equal(evaluateConsolidationSchedule(intervalCfg, evening).due, true, "Interval > 4h must fire");

    // ---- 2. LocalStore LLM Config & Masking Tests ----
    const store = new LocalStore(path.join(tmpDir, "state.json"));
    store.setCenterMemoryLlm({
        preset: "custom",
        provider: "openai-compatible",
        baseUrl: mockBaseUrl,
        apiKey: "sk-test-secret-key-9999",
        model: "mock-consolidator-v1",
        timeSlots: "12:30, 18:30, 21:30",
    });
    assert.equal(store.snapshot().centerMemoryLlm.apiKey, "sk-test-secret-key-9999");
    // Updating other fields with "__KEEP__" must preserve secret
    store.setCenterMemoryLlm({ apiKey: "__KEEP__", intervalHours: 6 });
    assert.equal(store.snapshot().centerMemoryLlm.apiKey, "sk-test-secret-key-9999");
    const pub = publicMemoryLlmConfig(store.snapshot().centerMemoryLlm);
    assert.equal(pub.hasApiKey, true);
    assert.equal(pub.configured, true);
    assert.equal("apiKey" in pub, false, "Public config must NEVER expose raw apiKey");
    assert.ok(pub.apiKeyPreview.includes("••••"));

    // Test LLM connection helper
    const ping = await testMemoryLlmConnection(store.snapshot().centerMemoryLlm);
    assert.equal(ping.ok, true);
    assert.equal(ping.reply, "ready");

    // ---- 3. Full 3-Node Convergence (Center + Endpoint A + Endpoint B) ----
    const centerEng = createCognitiveMemoryEngine({ getArchiveDir: () => path.join(tmpDir, "center"), home: tmpDir });
    const epAEng = createCognitiveMemoryEngine({ getArchiveDir: () => path.join(tmpDir, "epA"), home: tmpDir });
    const epBEng = createCognitiveMemoryEngine({ getArchiveDir: () => path.join(tmpDir, "epB"), home: tmpDir });

    // Endpoint A (MacBook) creates 3 memories: duplicate A1, outdated decision A2, noise A3
    const a1 = epAEng.retain({
        title: "Tailscale 组网方案记录",
        content: "MacBook 端使用内嵌 Tailscale tsnet 侧车连接中心点，通过 MagicDNS 域名穿透成功。",
        bank: "world",
        project: "qlex",
        originDevice: "MacBook",
    });
    const a2 = epAEng.retain({
        title: "旧方案：SQLite 存储记忆",
        content: "早期原型考虑过用 SQLite 数据库来保存本地记忆索引与知识图谱。",
        bank: "world",
        project: "qlex",
        originDevice: "MacBook",
    });
    const a3 = epAEng.retain({
        title: "临时测试杂音记录",
        content: "随便敲一段临时测试杂音看看同步接口通不通，没有任何后续参考价值。",
        bank: "world",
        originDevice: "MacBook",
    });

    // Endpoint B (WindowsPC) creates 2 memories: duplicate B1, newer decision B2
    const b1 = epBEng.retain({
        title: "Tailscale 内网穿透配置笔记",
        content: "WindowsPC 端同样通过内嵌 tsnet 加入 Tailnet 并使用 100.x 地址直连 Mac mini 中心点。",
        bank: "world",
        project: "qlex",
        originDevice: "WindowsPC",
    });
    const b2 = epBEng.retain({
        title: "新方案：gzip 零依赖存储记忆",
        content: "正式架构决定使用零依赖本地 gzip JSON 与可读 Markdown 替代 SQLite，确保跨平台免编译运行。",
        bank: "world",
        project: "qlex",
        originDevice: "WindowsPC",
    });

    // Both endpoints push raw memories to Center
    const mFromA = centerEng.mergeSyncBundle(epAEng.exportSyncBundle({ deviceId: "a", deviceName: "MacBook" }), { isCenter: true, peerName: "MacBook" });
    const mFromB = centerEng.mergeSyncBundle(epBEng.exportSyncBundle({ deviceId: "b", deviceName: "WindowsPC" }), { isCenter: true, peerName: "WindowsPC" });
    assert.equal(mFromA.itemsAdded, 3);
    assert.equal(mFromB.itemsAdded, 2);

    const beforeCons = centerEng.getConsolidationStatus();
    assert.equal(beforeCons.pendingCount, 5);
    assert.deepEqual(beforeCons.pendingDevices.sort(), ["MacBook", "WindowsPC"]);

    // Center runs LLM consolidation (triggered by time slot!)
    const callsBefore = llmCalls;
    const consRes = await centerEng.consolidateCenterMemory({
        llmConfig: store.snapshot().centerMemoryLlm,
        triggerReason: "slot_12:30",
        force: false,
        deviceName: "MacMini",
    });
    assert.equal(consRes.skipped, false);
    assert.equal(consRes.mode, "llm");
    assert.equal(consRes.revision, 1);
    assert.equal(consRes.stats.mergedGroups, 1);
    assert.equal(consRes.stats.prunedCount, 1);
    assert.equal(consRes.stats.synthesizedCount, 1);
    assert.equal(llmCalls, callsBefore + 1);
    assert.equal(centerEng.getConsolidationStatus().pendingCount, 0);
    assert.ok(lastPromptData.context.devices.includes("MacBook") && lastPromptData.context.devices.includes("WindowsPC"));

    // Running again with onlyWhenChanged=true and no new changes must skip (0 extra LLM calls)
    const skippedRes = await centerEng.consolidateCenterMemory({
        llmConfig: store.snapshot().centerMemoryLlm,
        triggerReason: "slot_18:30",
        force: false,
        deviceName: "MacMini",
    });
    assert.equal(skippedRes.skipped, true);
    assert.equal(skippedRes.reason, "no_changes");
    assert.equal(llmCalls, callsBefore + 1, "No-change run must NOT burn LLM tokens");

    // Center distributes canonical consolidated bundle to BOTH Endpoint A and Endpoint B
    const canonicalBundle = centerEng.exportSyncBundle({ deviceId: "center", deviceName: "MacMini", canonical: true });
    assert.equal(canonicalBundle.canonical, true);
    assert.equal(canonicalBundle.consolidation.revision, 1);

    const applyA = epAEng.mergeSyncBundle(canonicalBundle, { isCenter: false, peerName: "MacMini" });
    const applyB = epBEng.mergeSyncBundle(canonicalBundle, { isCenter: false, peerName: "MacMini" });
    assert.ok(applyA.tombstonesApplied >= 3, "Endpoint A must retire merged A1, superseded A2, and pruned A3");
    assert.ok(applyB.tombstonesApplied >= 1, "Endpoint B must retire merged B1");

    // Verify ALL 3 NODES converged to the EXACT same active memory IDs!
    const activeIdsOf = (eng) => eng.recall("", { limit: 100 }).results.map(r => r.id).sort();
    const centerIds = activeIdsOf(centerEng);
    const epAIds = activeIdsOf(epAEng);
    const epBIds = activeIdsOf(epBEng);

    assert.deepEqual(epAIds, centerIds, "Endpoint A active memories must match Center canonical set");
    assert.deepEqual(epBIds, centerIds, "Endpoint B active memories must match Center canonical set");

    // Verify duplicates, outdated decision, and noise are gone from active recall on all nodes
    for (const ids of [centerIds, epAIds, epBIds]) {
        assert.equal(ids.includes(a1.item.id), false, "Merged A1 must be superseded");
        assert.equal(ids.includes(b1.item.id), false, "Merged B1 must be superseded");
        assert.equal(ids.includes(a2.item.id), false, "Outdated SQLite decision A2 must be superseded");
        assert.equal(ids.includes(a3.item.id), false, "Pruned noise A3 must be deleted");
        assert.equal(ids.includes(b2.item.id), true, "Winning gzip decision B2 must stay active");
    }

    // Verify both endpoints see Center revision #1 & consolidated summary
    assert.equal(epAEng.getConsolidationStatus().syncedCenterRevision, 1);
    assert.equal(epBEng.getConsolidationStatus().syncedCenterRevision, 1);
    assert.ok(epAEng.readConsolidationReport().content.includes("Tailscale"));

    // ---- 4. Resilient JSON Repair / Truncation Recovery & Project-Grouped Batching Tests ----
    // Exact reproduction of DeepSeek max_tokens truncation mid-array (which previously threw Expected ',' or ']'!)
    const truncatedMidArray = [
        '```json',
        '{',
        '  "summary": "已合并重复记忆并淘汰杂音",',
        '  "merges": [],',
        '  "prunes": [',
        '    { "id": "mem_1", "reason": "一次性指令" },',
        '    { "id": "mem_2", "reason": "重复杂音" },',
        '    { "id": "mem_3", "reason": "此处输出超过 token 上限被直接截断',
    ].join("\n");
    const recovered = extractJsonObject(truncatedMidArray);
    assert.equal(recovered.summary, "已合并重复记忆并淘汰杂音");
    assert.equal(recovered.prunes.length, 2, "Must recover all complete array items before truncation");
    assert.equal(recovered.prunes[1].id, "mem_2");

    // Trailing comma + raw unescaped newline inside string
    const dirtyJson = `{\n  "summary": "第一行\n第二行",\n  "prunes": [{"id": "mem_x", "reason": "noise",},],\n}`;
    const repaired = extractJsonObject(dirtyJson);
    assert.equal(repaired.prunes.length, 1);
    assert.ok(repaired.summary.includes("第一行"));

    // 60 items grouped into <=25-item project-preserving batches
    const sixtyItems = Array.from({ length: 60 }, (_, idx) => ({
        id: `mem_${idx}`,
        project: idx < 20 ? "alpha" : idx < 40 ? "beta" : "gamma",
    }));
    const batches = buildConsolidationBatches(sixtyItems, 25);
    assert.equal(batches.length, 3, "60 items across 3 projects of 20 must split into 3 clean batches <= 25");
    assert.ok(batches.every(b => b.length <= 25));

    // ---- 5. Graceful fallback when LLM API fails ----
    llmFailNext = true;
    const fallbackRes = await centerEng.consolidateCenterMemory({
        llmConfig: store.snapshot().centerMemoryLlm,
        triggerReason: "manual",
        force: true,
        deviceName: "MacMini",
    });
    assert.equal(fallbackRes.mode, "fallback-rules", "HTTP 500 must degrade gracefully to rule consolidation");
    assert.equal(fallbackRes.revision, 2);
    assert.ok(fallbackRes.error.includes("500"));

    // ---- 6. Endpoint Auto-Sync on Center Revision Heartbeat (live HTTPS when node-forge available) ----
    let liveAutoSyncTested = false;
    let hasForge = false;
    try { require.resolve("node-forge"); hasForge = true; } catch { /* optional */ }
    if (hasForge) {
        const cStore = new LocalStore(path.join(tmpDir, "auto-c-state.json"));
        const eStore = new LocalStore(path.join(tmpDir, "auto-e-state.json"));
        const cArch = createMemoryArchiver({ getArchiveDir: () => path.join(tmpDir, "auto-c-mem"), home: tmpDir });
        const eArch = createMemoryArchiver({ getArchiveDir: () => path.join(tmpDir, "auto-e-mem"), home: tmpDir });
        const epEvents = [];
        const cPair = new DevicePairing(cStore, 0, null, () => ["127.0.0.1"], cArch);
        const ePair = new DevicePairing(eStore, 0, null, () => ["127.0.0.1"], eArch, (ev) => epEvents.push(ev));
        await cPair.start();
        try {
            const invite = cPair.createInvite("127.0.0.1");
            await ePair.join(invite);
            cPair.decide(eStore.snapshot().deviceId, true);
            // Center adds a new memory & consolidates (bumps revision -> 1)
            cArch.retain({ title: "中心自动推送测试记忆", content: "中心完成整理后接入点心跳应自动拉取该条权威记忆。", bank: "world", project: "qlex" });
            await cArch.consolidateNow({ llmConfig: { enabled: false }, triggerReason: "slot_12:30", force: true, deviceName: "Center" });
            assert.equal(cArch.getConsolidationStatus().revision, 1);

            // Endpoint runs heartbeat refresh() (10s timer) — MUST auto-detect connected + rev 1 and auto-sync!
            await ePair.refresh();
            if (ePair.memorySyncing) await ePair.memorySyncing;
            assert.equal(eArch.getConsolidationStatus().syncedCenterRevision, 1, "Endpoint heartbeat must auto-sync Center revision #1");
            assert.ok(eArch.recall("中心自动推送测试记忆", { level: "L0" }).results.length >= 1, "Endpoint must automatically pull Center memory");
            assert.ok(epEvents.includes("memory"), "Endpoint onChange('memory') must fire on auto-sync");
            liveAutoSyncTested = true;
        } finally {
            cPair.stop();
        }
    }

    console.log("ALL QLEX CENTER LLM MEMORY CONSOLIDATION & MULTI-ENDPOINT CONVERGENCE TESTS PASSED!", JSON.stringify({
        convergedActiveCount: centerIds.length,
        llmRevision: consRes.revision,
        fallbackRevision: fallbackRes.revision,
        epASyncedRevision: epAEng.getConsolidationStatus().syncedCenterRevision,
        epBSyncedRevision: epBEng.getConsolidationStatus().syncedCenterRevision,
        liveAutoSyncTested,
        llmCalls,
    }));
} finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
}
