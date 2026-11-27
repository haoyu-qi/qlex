#!/usr/bin/env node
/**
 * Integration tests for QLEX v0.2.0-beta.1 new pillars:
 *  1. Native 5-Agent Log Collector (Codex, Claude, Antigravity T3, Hermes, DSH)
 *  2. Tailscale SDK Manager + MagicDNS Invite + Center Discover endpoint
 *  3. Version Updater (Semver, Beta/Stable channel filter, Checksum parse & SHA-256 verification)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const { collectAllNative, extractRealUserText } = require(path.join(root, "desktop/src/collectors/index.js"));
const { createTailscaleManager, isTailscaleIp, isMagicDnsHost, findEmbeddedTsnetBin } = require(path.join(root, "desktop/src/tailscale.js"));
const { DevicePairing, isValidHost, isTailscaleIPv4, addresses } = require(path.join(root, "desktop/src/pairing.js"));
const { LocalStore } = require(path.join(root, "desktop/src/state.js"));
const {
    findAutoMatchDirectory,
    scanProjectFiles,
    diffFileManifests,
    packProjectFiles,
    unpackProjectFiles,
    applyProjectFiles,
    getProjectMirrorDir,
    materializeMirrorToDirectory,
} = require(path.join(root, "desktop/src/project-sync.js"));
const { createSkillSync } = require(path.join(root, "desktop/src/skill-sync.js"));
const { createCognitiveMemoryEngine } = require(path.join(root, "desktop/src/memory-core.js"));
const { createUpdater, compareVersions, parseChecksumsText } = require(path.join(root, "desktop/src/updater.js"));

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "qlex-v020-test-"));

try {
    // ---- 1. Native Multi-Agent Collector Tests ----
    const nowIso = new Date().toISOString();
    // Codex rollout
    const codexDir = path.join(tmpHome, ".codex/sessions/2026/11/24");
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, "rollout-2026-11-24T00-00-01-test.jsonl"), [
        JSON.stringify({ timestamp: nowIso, type: "session_meta", payload: { session_id: "codex-1", cwd: tmpHome } }),
        JSON.stringify({ timestamp: nowIso, type: "event_msg", payload: { type: "user_message", message: "修复本地 Agent 日志采集问题" } }),
        JSON.stringify({ timestamp: nowIso, type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1200, cached_input_tokens: 200, output_tokens: 300 } } } }),
    ].join("\n") + "\n");

    // Claude project jsonl
    const claudeDir = path.join(tmpHome, ".claude/projects/-tmp-demo");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "sess-1.jsonl"), [
        JSON.stringify({ timestamp: nowIso, cwd: tmpHome, sessionId: "claude-1", message: { id: "m1", role: "assistant", usage: { input_tokens: 500, output_tokens: 150, cache_read_input_tokens: 400, cache_creation_input_tokens: 50 } } }),
        JSON.stringify({ timestamp: nowIso, cwd: tmpHome, sessionId: "claude-1", message: { id: "m1", role: "assistant", usage: { input_tokens: 500, output_tokens: 150, cache_read_input_tokens: 400, cache_creation_input_tokens: 50 } } }), // dup
    ].join("\n") + "\n");

    // Antigravity T3 ACP transcript
    const agDir = path.join(tmpHome, ".t3/userdata/providers/antigravity/abc/antigravity-acp/brain/conv-1/.system_generated/logs");
    fs.mkdirSync(agDir, { recursive: true });
    fs.writeFileSync(path.join(agDir, "transcript.jsonl"), [
        JSON.stringify({ created_at: nowIso, type: "USER_INPUT", content: `<USER_REQUEST><t3_code_instructions>ignore me</t3_code_instructions><user_request>嵌入 tailscale SDK 自动发现</user_request></USER_REQUEST>` }),
        JSON.stringify({ created_at: nowIso, type: "PLANNER_RESPONSE", content: `Command Working Directory: ${tmpHome}\nImplementing tsnet sidecar and updater...` }),
    ].join("\n") + "\n");

    // DSH zstd or jsonl session
    const dshDir = path.join(tmpHome, ".dsh/sessions/--tmp--/session-dsh-1");
    fs.mkdirSync(dshDir, { recursive: true });
    const dshLine = JSON.stringify({ timestamp: nowIso, cwd: tmpHome, role: "assistant", usage: { input_tokens: 600, output_tokens: 200 } }) + "\n";
    if (typeof zlib.zstdCompressSync === "function") {
        fs.writeFileSync(path.join(dshDir, "session.v4.jsonl.zstd"), zlib.zstdCompressSync(Buffer.from(dshLine)));
    } else {
        fs.writeFileSync(path.join(dshDir, "session.v4.jsonl"), dshLine);
    }

    const nativeRes = await collectAllNative({
        home: tmpHome,
        env: {},
        cachePath: path.join(tmpHome, "collector-cache.json"),
        days: 7,
    });
    assert.equal(nativeRes.today.totals.codex.tokens, 1500);
    assert.equal(nativeRes.today.totals.claude.tokens, 1100, "Duplicate Claude message usage must be deduplicated");
    assert.ok(nativeRes.today.totals.antigravity.tokens > 0, "Antigravity T3 ACP transcript must be collected");
    assert.equal(nativeRes.today.totals.dsh.tokens, 800, "DSH session must be collected");
    assert.equal(nativeRes.diagnostics.codex.status, "ok");
    assert.equal(nativeRes.diagnostics.claude.status, "ok");
    assert.equal(nativeRes.diagnostics.antigravity.status, "ok");
    assert.equal(nativeRes.diagnostics.dsh.status, "ok");
    assert.equal(extractRealUserText("<USER_REQUEST><t3_code_instructions>xxx</t3_code_instructions><user_request>你好世界</user_request></USER_REQUEST>"), "你好世界");

    // ---- 2. Tailscale SDK + MagicDNS Pairing Invite Test ----
    assert.equal(isTailscaleIp("100.76.221.117"), true);
    assert.equal(isTailscaleIp("192.168.1.5"), false);
    assert.equal(isMagicDnsHost("macbook-pro.tailffde7.ts.net"), true);
    assert.equal(isValidHost("macbook-pro.tailffde7.ts.net"), true);
    assert.equal(isValidHost("100.76.221.117"), true);
    assert.equal(isTailscaleIPv4("100.76.221.117"), true);
    const prioritized = addresses(["192.168.1.10", "100.76.221.117", "macbook-pro.tailffde7.ts.net"]);
    assert.equal(prioritized[0], "macbook-pro.tailffde7.ts.net", "MagicDNS must rank first");
    assert.equal(prioritized[1], "100.76.221.117", "Tailscale 100.x IP must rank before LAN");

    const store = new LocalStore(path.join(tmpHome, "state.json"));
    assert.equal(store.snapshot().updateChannel, "beta");
    store.setUpdateChannel("stable");
    assert.equal(store.snapshot().updateChannel, "stable");

    // Full DevicePairing HTTPS + MagicDNS invite test if node-forge is available
    let hasForge = false;
    try { require.resolve("node-forge"); hasForge = true; } catch {}
    if (hasForge) {
        const pairing = new DevicePairing(store, 0, null, () => ["macbook-pro.tailffde7.ts.net", "100.76.221.117"]);
        await pairing.start();
        try {
            const view = pairing.view();
            assert.equal(view.addressEntries[0].host, "macbook-pro.tailffde7.ts.net");
            assert.equal(view.addressEntries[0].kind, "tailscale");
            const inviteCode1 = pairing.createInvite("macbook-pro.tailffde7.ts.net");
            const inviteCode2 = pairing.createInvite("macbook-pro.tailffde7.ts.net");
            assert.ok(inviteCode1.startsWith("QLEX1."));
            assert.notEqual(inviteCode1, inviteCode2, "Refreshing invite must generate a brand-new token");
            assert.equal(pairing.view().activeInvite?.code, inviteCode2, "view().activeInvite must expose latest invite code");
        } finally {
            pairing.stop();
        }
    }

    const tsMgr = createTailscaleManager({ dataDir: tmpHome });
    const tsSnap = tsMgr.snapshot();
    assert.equal(typeof tsSnap.embeddedAvailable, "boolean");
    tsMgr.stop();

    // ---- 3. Version Updater Channel & Semver Tests ----
    assert.ok(compareVersions("0.2.0-beta.2", "0.2.0-beta.1") > 0);
    assert.ok(compareVersions("0.2.0", "0.2.0-beta.2") > 0);
    assert.ok(compareVersions("0.2.0-beta.1", "0.1.9-memory.2") > 0);
    const sums = parseChecksumsText("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  QLEX-0.2.0-beta.1-macOS-arm64.pkg\n");
    assert.equal(sums["QLEX-0.2.0-beta.1-macOS-arm64.pkg"], "a".repeat(64));

    const mockReleases = [
        {
            tag_name: "v0.6.0-beta.2",
            name: "QLEX 0.2.0-beta.2",
            prerelease: true,
            draft: false,
            html_url: "https://github.com/haoyu-qi/qlex/releases/tag/v0.6.0-beta.2",
            assets: [{ name: "QLEX-0.2.0-beta.2-macOS-arm64.pkg", browser_download_url: "https://example.invalid/pkg", size: 1234 }],
        },
        {
            tag_name: "v0.5.0",
            name: "QLEX 0.1.9",
            prerelease: false,
            draft: false,
            html_url: "https://github.com/haoyu-qi/qlex/releases/tag/v0.5.0",
            assets: [{ name: "QLEX-0.1.9-macOS-arm64.pkg", browser_download_url: "https://example.invalid/old", size: 1000 }],
        },
    ];
    let notified = null;
    const betaUpdater = createUpdater({
        currentVersion: "0.2.0-beta.1",
        getChannel: () => "beta",
        onUpdateFound: (r) => { notified = r; },
    });
    const betaCheck = await betaUpdater.checkForUpdates({ mockReleases });
    assert.equal(betaCheck.phase, "available");
    assert.equal(betaCheck.latest.version, "0.2.0-beta.2");
    assert.equal(notified?.version, "0.2.0-beta.2");

    const stableUpdater = createUpdater({ currentVersion: "0.2.0-beta.1", getChannel: () => "stable" });
    const stableCheck = await stableUpdater.checkForUpdates({ mockReleases });
    assert.equal(stableCheck.phase, "up-to-date", "Stable channel must ignore beta pre-releases");

    // Updater cached-file SHA-256 fast-path + installing phase transitions + check protection
    const crypto = await import("node:crypto");
    const updCacheDir = path.join(tmpHome, "upd-cache");
    fs.mkdirSync(updCacheDir, { recursive: true });
    const fakePkgName = "QLEX-0.3.0-beta.99-macOS-arm64.pkg";
    const fakePkgBytes = Buffer.from("QLEX-FAKE-PKG-CONTENT-FOR-HASH-CHECK");
    const fakePkgSha = crypto.createHash("sha256").update(fakePkgBytes).digest("hex");
    fs.writeFileSync(path.join(updCacheDir, fakePkgName), fakePkgBytes);
    const updEvents = [];
    const dlUpdater = createUpdater({
        currentVersion: "0.3.0-beta.13",
        cacheDir: updCacheDir,
        getChannel: () => "beta",
        onChange: (st) => updEvents.push({ phase: st.phase, progress: st.progress }),
    });
    await dlUpdater.checkForUpdates({
        mockReleases: [{
            tag_name: "v0.3.0-beta.99",
            name: "QLEX 0.3.0-beta.99",
            prerelease: true,
            draft: false,
            html_url: "https://github.com/haoyu-qi/qlex/releases/tag/v0.3.0-beta.99",
            assets: [{ name: fakePkgName, browser_download_url: "https://example.invalid/pkg", size: fakePkgBytes.length }],
        }],
    });
    const dlState = await dlUpdater.downloadUpdate();
    assert.equal(dlState.phase, "ready");
    assert.equal(dlState.progress, 100);
    assert.equal(dlState.verifiedSha256, fakePkgSha);
    assert.ok(updEvents.some(e => e.phase === "verifying"), "Must emit verifying phase");
    assert.equal(dlUpdater.setInstalling(true).phase, "installing");
    const duringInstall = await dlUpdater.checkForUpdates({ mockReleases });
    assert.equal(duringInstall.phase, "installing", "checkForUpdates must not clobber active installing phase");
    assert.equal(dlUpdater.setInstalling(false).phase, "ready", "Cancelling install must restore ready phase");
    assert.equal(dlUpdater.setInstalling(false, "mock err").phase, "error", "Install error must set error phase");

    // ---- 4. Center <-> Endpoint Bidirectional Memory Sync & Project Sync Tests ----
    const centerMemDir = path.join(tmpHome, "center-mem");
    const endpointMemDir = path.join(tmpHome, "endpoint-mem");
    const centerMem = createCognitiveMemoryEngine({ getArchiveDir: () => centerMemDir, home: tmpHome });
    const endpointMem = createCognitiveMemoryEngine({ getArchiveDir: () => endpointMemDir, home: tmpHome });

    const cAdd = centerMem.retain({ title: "中心端架构决策", content: "Mac mini 作为 QLEX 中心点托管共享记忆与项目。", bank: "world", project: "workcontext" });
    const eAdd = endpointMem.retain({ title: "接入端偏好", content: "MacBook 接入点偏好使用 Tailscale 直连中心。", bank: "opinion", project: "workcontext" });

    // Simulate Endpoint -> Center merge, then Center -> Endpoint merge (single roundtrip!)
    const epBundle = endpointMem.exportSyncBundle({ deviceId: "ep-1", deviceName: "MacBook" });
    const centerMerge = centerMem.mergeSyncBundle(epBundle);
    assert.equal(centerMerge.itemsAdded, 1, "Center must receive Endpoint memory item");
    const ctrBundle = centerMem.exportSyncBundle({ deviceId: "ctr-1", deviceName: "MacMini" });
    const epMerge = endpointMem.mergeSyncBundle(ctrBundle);
    assert.equal(epMerge.itemsAdded, 1, "Endpoint must receive Center memory item");
    assert.ok(endpointMem.recall("Mac mini 中心点", { level: "L0" }).results.some(r => r.id === cAdd.item.id));
    assert.ok(centerMem.recall("Tailscale 直连", { level: "L0" }).results.some(r => r.id === eAdd.item.id));

    // Simulate Cross-Device Project & Workspace Context Sync + Rename + Tombstone Removal + Auto-Match
    const centerStore = new LocalStore(path.join(tmpHome, "center-state.json"));
    const epStore = new LocalStore(path.join(tmpHome, "ep-state.json"));
    const fakeProjA = path.join(tmpHome, "proj-alpha");
    const fakeProjB = path.join(tmpHome, "ep-proj-alpha");
    fs.mkdirSync(path.join(fakeProjA, ".git/refs/heads"), { recursive: true });
    fs.writeFileSync(path.join(fakeProjA, ".git/HEAD"), "ref: refs/heads/main\n");
    fs.writeFileSync(path.join(fakeProjA, ".git/refs/heads/main"), "ea536f71234567890abcdef1234567890abcdef1\n");
    fs.writeFileSync(path.join(fakeProjA, ".git/config"), '[remote "origin"]\n\turl = https://github.com/haoyu-qi/qlex.git\n');
    fs.writeFileSync(path.join(fakeProjA, "AGENTS.md"), "# QLEX Workspace Rules\nAlways sync cleanly.\n");
    fs.mkdirSync(path.join(fakeProjB, ".git"), { recursive: true });
    fs.writeFileSync(path.join(fakeProjB, ".git/config"), '[remote "origin"]\n\turl = git@github.com:haoyu-qi/qlex.git\n');

    centerStore.addProject(fakeProjA);
    const sharedFromCenter = centerStore.exportSharedProjects("MacMini");
    assert.equal(sharedFromCenter.projects.length, 1);
    assert.equal(sharedFromCenter.projects[0].gitBranch, "main");
    assert.equal(sharedFromCenter.projects[0].gitCommit, "ea536f7");
    assert.equal(sharedFromCenter.projects[0].contextFiles.length, 1);

    const mergeProjRes = epStore.mergeSharedProjects(sharedFromCenter, { peerName: "MacMini", backupRoot: path.join(tmpHome, "backups") });
    assert.equal(mergeProjRes.added, 1);
    assert.equal(epStore.snapshot().remoteProjects.length, 1);
    const remoteEntry = epStore.snapshot().remoteProjects[0];
    const autoMatch = findAutoMatchDirectory(remoteEntry, [{ directory: fakeProjB, name: "ep-proj-alpha" }]);
    assert.equal(autoMatch?.directory, fakeProjB, "Auto-match must recognize matching Git remote across SSH/HTTPS");

    const syncId = remoteEntry.syncId;
    epStore.bindRemoteProject(syncId, fakeProjB, { backupRoot: path.join(tmpHome, "backups") });
    assert.equal(epStore.snapshot().remoteProjects.length, 0);
    assert.equal(epStore.snapshot().projects[0].syncId, syncId, "Bound local directory must preserve cross-device syncId");
    assert.equal(fs.readFileSync(path.join(fakeProjB, "AGENTS.md"), "utf8"), "# QLEX Workspace Rules\nAlways sync cleanly.\n", "Binding must sync workspace AGENTS.md");

    // Rename propagation (must bump updatedAt so LWW propagates)
    const centerProjId = centerStore.snapshot().projects[0].id;
    await new Promise(r => setTimeout(r, 10));
    centerStore.renameProject(centerProjId, "proj-alpha-renamed");
    const renamePayload = centerStore.exportSharedProjects("MacMini");
    epStore.mergeSharedProjects(renamePayload, { peerName: "MacMini", backupRoot: path.join(tmpHome, "backups") });
    assert.equal(epStore.snapshot().projects[0].name, "proj-alpha-renamed", "Project rename must propagate across devices");

    // Deletion tombstone propagation (must NOT resurrect deleted project)
    await new Promise(r => setTimeout(r, 10));
    epStore.removeProject(epStore.snapshot().projects[0].id);
    const deletePayload = epStore.exportSharedProjects("MacBook");
    assert.equal(deletePayload.deleted.length, 1);
    const delMerge = centerStore.mergeSharedProjects(deletePayload, { peerName: "MacBook" });
    assert.equal(delMerge.removed, 1, "Tombstone deletion must propagate to peer");
    assert.equal(centerStore.snapshot().projects.length, 0, "Deleted project must not remain on peer");

    // Live HTTPS Center <-> Endpoint project sync test when node-forge is available
    let liveHttpsProjectSyncPassed = false;
    if (hasForge) {
        const liveCenterStore = new LocalStore(path.join(tmpHome, "live-center.json"));
        const liveEpStore = new LocalStore(path.join(tmpHome, "live-ep.json"));
        const centerSyncDir = path.join(tmpHome, "center-QLEX-Projects");
        const epSyncDir = path.join(tmpHome, "ep-QLEX-Projects");
        liveCenterStore.setProjectSyncDir(centerSyncDir);
        liveEpStore.setProjectSyncDir(epSyncDir);
        let centerEvents = [];
        const liveCenter = new DevicePairing(liveCenterStore, 0, null, () => ["127.0.0.1"], null, (ev) => centerEvents.push(ev));
        const liveEp = new DevicePairing(liveEpStore, 0, null, () => ["127.0.0.1"], null);
        await liveCenter.start();
        try {
            const invite = liveCenter.createInvite("127.0.0.1");
            await liveEp.join(invite);
            const epId = liveEpStore.snapshot().deviceId;
            liveCenter.decide(epId, true);
            await liveEp.refresh();
            assert.equal(liveEp.view().endpoint?.status, "connected");

            // Endpoint adds a project with real binary deliverables (.png, .pptx, .zip) + hidden build cache (.pptx-build)
            const liveProj = path.join(tmpHome, "live-sync-repo");
            fs.mkdirSync(path.join(liveProj, "PPT交付"), { recursive: true });
            fs.mkdirSync(path.join(liveProj, ".pptx-build"), { recursive: true });
            fs.writeFileSync(path.join(liveProj, "需求说明.md"), "# 跨端项目说明\n");
            fs.writeFileSync(path.join(liveProj, "PPT交付/方案.pptx"), Buffer.alloc(128 * 1024, 0x50));
            fs.writeFileSync(path.join(liveProj, "PPT交付/首页.png"), Buffer.alloc(64 * 1024, 0x89));
            fs.writeFileSync(path.join(liveProj, ".pptx-build/temp.json"), '{"junk":true}\n');
            liveEpStore.addProject(liveProj);

            const syncRes = await liveEp.syncProjects();
            assert.equal(syncRes.role, "endpoint");
            assert.equal(syncRes.totalShared, 1);
            assert.ok(liveEp.view().syncMeta.lastProjectsSync?.time > 0, "lastProjectsSync must be exposed");
            assert.ok(centerEvents.includes("projects"), "Center onChange must fire immediately on project sync");

            // Center has autoSaveSyncedProjects=true -> must auto-create centerSyncDir/live-sync-repo & materialize deliverables (without .pptx-build junk!)
            const autoSavedDir = path.join(centerSyncDir, "live-sync-repo");
            assert.equal(liveCenterStore.snapshot().projects.length, 1, "Center must auto-bind synced project into QLEX-Projects folder");
            assert.equal(liveCenterStore.snapshot().projects[0].directory, autoSavedDir);
            assert.equal(fs.existsSync(path.join(autoSavedDir, "需求说明.md")), true, "Markdown file must sync");
            assert.equal(fs.existsSync(path.join(autoSavedDir, "PPT交付/方案.pptx")), true, "PPTX deliverable must sync");
            assert.equal(fs.existsSync(path.join(autoSavedDir, "PPT交付/首页.png")), true, "PNG image deliverable must sync");
            assert.equal(fs.existsSync(path.join(autoSavedDir, ".pptx-build/temp.json")), false, "Hidden build cache .pptx-build must be excluded");

            // Reverse direction: Center creates a PDF deliverable inside autoSavedDir -> Endpoint pulls it!
            fs.writeFileSync(path.join(autoSavedDir, "PPT交付/评审纪要.pdf"), Buffer.alloc(48 * 1024, 0x25));
            const revSync = await liveEp.syncProjects();
            assert.ok(revSync.filesPulled >= 1, "Endpoint must pull new PDF from Center");
            assert.equal(fs.existsSync(path.join(liveProj, "PPT交付/评审纪要.pdf")), true, "PDF must materialize on Endpoint");
            liveHttpsProjectSyncPassed = true;
        } finally {
            liveCenter.stop();
        }
    }

    // ---- 5. Hermes Bundled / WebUI / Manual Skill Exclusion & Origin Classification Tests ----
    const skHome = path.join(tmpHome, "skill-policy-home");
    const hermesSkills = path.join(skHome, ".hermes/skills");
    const codexSkills = path.join(skHome, ".codex/skills");
    fs.mkdirSync(path.join(hermesSkills, "creative/humanizer"), { recursive: true });
    fs.writeFileSync(path.join(hermesSkills, "creative/DESCRIPTION.md"), "Creative skills category\n");
    fs.writeFileSync(path.join(hermesSkills, "creative/humanizer/SKILL.md"), "# humanizer\n");
    fs.mkdirSync(path.join(hermesSkills, "apple-notes"), { recursive: true });
    fs.writeFileSync(path.join(hermesSkills, "apple-notes/SKILL.md"), "# apple-notes\n");
    fs.mkdirSync(path.join(hermesSkills, "grok-image-to-video"), { recursive: true });
    fs.writeFileSync(path.join(hermesSkills, "grok-image-to-video/SKILL.md"), "# grok\n");
    fs.mkdirSync(path.join(hermesSkills, "qhy-custom"), { recursive: true });
    fs.writeFileSync(path.join(hermesSkills, "qhy-custom/SKILL.md"), "# qhy-custom\n");
    fs.mkdirSync(path.join(hermesSkills, "private-only"), { recursive: true });
    fs.writeFileSync(path.join(hermesSkills, "private-only/SKILL.md"), "# private-only\n");
    fs.writeFileSync(path.join(hermesSkills, ".bundled_manifest"), "apple-notes:abc123\nhumanizer:def456\n");
    fs.writeFileSync(path.join(hermesSkills, ".webui-managed-skills.json"), JSON.stringify({
        "grok-image-to-video": { owner: "hermes-web-ui", source_hash: "111", installed_hash: "111" },
    }));
    fs.mkdirSync(codexSkills, { recursive: true });

    const skStore = new LocalStore(path.join(tmpHome, "sk-state.json"));
    skStore.toggleExcludedSkill("private-only", true);
    const skEngine = createSkillSync(path.join(tmpHome, "sk-data"), skHome, {
        getPolicy: () => skStore.snapshot().skillSyncPolicy,
    });
    const scanBefore = skEngine.scanLocal(["hermes", "codex"]);
    assert.equal(scanBefore.anomalies.filter(a => a.name === "creative").length, 0, "Hermes category dir must NOT be flagged as missing-skill-md anomaly");
    assert.equal(scanBefore.originCounts.hermesBundled, 2, "Both top-level apple-notes and category-nested creative/humanizer must be classified as hermes-bundled");
    assert.equal(scanBefore.originCounts.hermesWebui, 1, "grok-image-to-video must be classified as hermes-webui");
    assert.equal(scanBefore.originCounts.manualExcluded, 1, "private-only must be manually excluded");
    assert.equal(scanBefore.originCounts.syncable, 1, "Only qhy-custom should be syncable");

    skEngine.syncLocal(["hermes", "codex"]);
    assert.equal(fs.existsSync(path.join(codexSkills, "qhy-custom/SKILL.md")), true, "User skill must sync to Codex");
    assert.equal(fs.existsSync(path.join(codexSkills, "apple-notes/SKILL.md")), false, "Hermes bundled skill must NOT sync to Codex");
    assert.equal(fs.existsSync(path.join(codexSkills, "grok-image-to-video/SKILL.md")), false, "Hermes WebUI skill must NOT sync to Codex");
    assert.equal(fs.existsSync(path.join(codexSkills, "private-only/SKILL.md")), false, "Manually excluded skill must NOT sync to Codex");

    const catNames = skEngine.catalog().map(c => c.name);
    assert.equal(catNames.includes("qhy-custom"), true);
    assert.equal(catNames.includes("apple-notes"), false, "Center catalog must exclude Hermes bundled skill");
    assert.equal(catNames.includes("grok-image-to-video"), false, "Center catalog must exclude Hermes WebUI skill");
    assert.equal(catNames.includes("private-only"), false, "Center catalog must exclude manually excluded skill");

    // Un-excluding restores sync immediately
    skStore.toggleExcludedSkill("private-only", false);
    skEngine.syncLocal(["hermes", "codex"]);
    assert.equal(fs.existsSync(path.join(codexSkills, "private-only/SKILL.md")), true, "Un-excluded skill must sync cleanly");

    // ---- 6. Full Workspace File Sync (Source + Docs + Task Files + Center Mirror Materialization) ----
    const wsSrc = path.join(tmpHome, "ws-src");
    const wsEmptyDst = path.join(tmpHome, "ws-empty-dst");
    const mirrorDataDir = path.join(tmpHome, "center-data");
    fs.mkdirSync(path.join(wsSrc, "src"), { recursive: true });
    fs.mkdirSync(path.join(wsSrc, "node_modules/pkg"), { recursive: true });
    fs.writeFileSync(path.join(wsSrc, "README.md"), "# Demo Project\n");
    fs.writeFileSync(path.join(wsSrc, "TASKS.md"), "- [x] Sync project files\n");
    fs.writeFileSync(path.join(wsSrc, "src/index.js"), "console.log('hello qlex');\n");
    fs.writeFileSync(path.join(wsSrc, ".env"), "SECRET_KEY=must-never-sync\n");
    fs.writeFileSync(path.join(wsSrc, "node_modules/pkg/a.js"), "// ignored\n");

    const scannedSrc = scanProjectFiles(wsSrc);
    const scannedPaths = scannedSrc.files.map(f => f.path).sort();
    assert.deepEqual(scannedPaths, ["README.md", "TASKS.md", "src/index.js"], "Must include code/docs/tasks and skip .env and node_modules");

    const diff0 = diffFileManifests([], scannedSrc.files);
    assert.equal(diff0.toPull.length, 3);
    const packedBatch = packProjectFiles(wsSrc, diff0.toPull);
    assert.equal(packedBatch.count, 3);
    const mirrorDir = getProjectMirrorDir(mirrorDataDir, "proj_demo");
    const appliedMirror = applyProjectFiles(mirrorDir, unpackProjectFiles(packedBatch.gzipBase64), "proj_demo", path.join(tmpHome, "backups"));
    assert.equal(appliedMirror.written, 3, "Center mirror must store all 3 workspace files");

    // Bind empty folder on Center -> must materialize all 3 files immediately!
    fs.mkdirSync(wsEmptyDst, { recursive: true });
    const matRes = materializeMirrorToDirectory(mirrorDataDir, "proj_demo", wsEmptyDst, path.join(tmpHome, "backups"));
    assert.equal(matRes.written, 3, "Empty bound folder must receive all 3 mirrored workspace files");
    assert.equal(fs.readFileSync(path.join(wsEmptyDst, "TASKS.md"), "utf8"), "- [x] Sync project files\n");
    assert.equal(fs.existsSync(path.join(wsEmptyDst, ".env")), false, "Sensitive .env must never be synced");

    // ---- 7. Binary Deliverables (PPTX > 8MB, PNG, PDF, DOCX, ZIP) + Hidden Build Dir Exclusion + Auto QLEX-Projects Folder ----
    const binSrc = path.join(tmpHome, "云传项目");
    const autoSyncRoot = path.join(tmpHome, "QLEX-Projects");
    fs.mkdirSync(path.join(binSrc, "PPT交付"), { recursive: true });
    fs.mkdirSync(path.join(binSrc, "设计稿"), { recursive: true });
    fs.mkdirSync(path.join(binSrc, ".pptx-build"), { recursive: true });
    fs.mkdirSync(path.join(binSrc, ".chart-data-abc"), { recursive: true });
    fs.mkdirSync(path.join(binSrc, ".github/workflows"), { recursive: true });
    const bigPptx = Buffer.alloc(9 * 1024 * 1024, 0x50); // 9 MB > 8 MB batch limit, must pack cleanly as solo batch!
    const samplePng = Buffer.alloc(180 * 1024, 0x89);
    const samplePdf = Buffer.alloc(120 * 1024, 0x25);
    const sampleZip = Buffer.alloc(250 * 1024, 0x50);
    fs.writeFileSync(path.join(binSrc, "PPT交付/汇报.pptx"), bigPptx);
    fs.writeFileSync(path.join(binSrc, "设计稿/首页.png"), samplePng);
    fs.writeFileSync(path.join(binSrc, "需求.pdf"), samplePdf);
    fs.writeFileSync(path.join(binSrc, "交付包.zip"), sampleZip);
    fs.writeFileSync(path.join(binSrc, ".github/workflows/ci.yml"), "name: CI\n");
    fs.writeFileSync(path.join(binSrc, ".pptx-build/deck.json"), '{"junk":true}\n');
    fs.writeFileSync(path.join(binSrc, ".chart-data-abc/snap.json"), '{"junk":true}\n');

    const binScanned = scanProjectFiles(binSrc);
    const binPaths = binScanned.files.map(f => f.path).sort();
    assert.deepEqual(binPaths, [
        ".github/workflows/ci.yml",
        "PPT交付/汇报.pptx",
        "交付包.zip",
        "设计稿/首页.png",
        "需求.pdf",
    ], "Must sync binary deliverables & .github while excluding .pptx-build and .chart-data-*");

    // Multi-batch pack & unpack including 9 MB single file (> 8 MB batch threshold)
    const mirrorData2 = path.join(tmpHome, "center-data-2");
    const binMirror = getProjectMirrorDir(mirrorData2, "proj_云传项目");
    let pushedFiles = 0;
    for (let idx = 0; idx < binPaths.length; ) {
        const slice = binPaths.slice(idx, idx + 80);
        const packed = packProjectFiles(binSrc, slice);
        assert.ok(packed.count >= 1, "Single 9MB file must still pack as its own batch without stalling");
        const applied = applyProjectFiles(binMirror, unpackProjectFiles(packed.gzipBase64), "proj_云传项目", path.join(tmpHome, "backups"));
        pushedFiles += applied.written;
        idx += packed.count;
    }
    assert.equal(pushedFiles, 5, "All 5 files including 9MB PPTX must sync across batches");

    // Auto-bind into dedicated QLEX-Projects/<项目名> folder
    const autoStore = new LocalStore(path.join(tmpHome, "auto-state.json"));
    autoStore.setProjectSyncDir(autoSyncRoot);
    const autoMerge = autoStore.mergeSharedProjects(
        { projects: [{ syncId: "proj_云传项目", name: "云传项目", originDevice: "MacBook", updatedAt: Date.now() }], deleted: [] },
        { peerName: "MacBook", autoBindDir: autoSyncRoot, dataDir: mirrorData2, backupRoot: path.join(tmpHome, "backups") }
    );
    assert.equal(autoMerge.autoBound, 1, "Remote project must auto-bind into dedicated QLEX-Projects subdir");
    const expectedFolder = path.join(autoSyncRoot, "云传项目");
    assert.equal(autoStore.snapshot().projects[0].directory, expectedFolder);
    assert.equal(fs.statSync(path.join(expectedFolder, "PPT交付/汇报.pptx")).size, bigPptx.length, "9MB PPTX must materialize intact inside QLEX-Projects/云传项目");
    assert.equal(fs.existsSync(path.join(expectedFolder, ".pptx-build/deck.json")), false);

    console.log("ALL QLEX v0.3.0-beta.7 CORE SYNC / BINARY DELIVERABLES / AUTO-FOLDER / SKILL POLICY / COLLECTOR / TAILSCALE / UPDATER TESTS PASSED!", JSON.stringify({
        nativeTokens: nativeRes.today.total,
        embeddedTsnetBuilt: Boolean(findEmbeddedTsnetBin()),
        betaDetected: betaCheck.latest.version,
        stablePhase: stableCheck.phase,
        syncedMemoryBidirectional: true,
        syncedProjectBoundSyncId: syncId,
        workspaceFilesSynced: matRes.written,
        binaryDeliverablesSynced: pushedFiles,
        autoSavedProjectDir: expectedFolder,
        liveHttpsProjectSyncPassed,
        skillPolicyVerified: true,
    }));
} finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
}
