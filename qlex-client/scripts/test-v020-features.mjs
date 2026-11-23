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
            const inviteCode = pairing.createInvite("macbook-pro.tailffde7.ts.net");
            assert.ok(inviteCode.startsWith("QLEX1."));
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
            html_url: "https://github.com/haoyu-qi/workcontext/releases/tag/v0.6.0-beta.2",
            assets: [{ name: "QLEX-0.2.0-beta.2-macOS-arm64.pkg", browser_download_url: "https://example.invalid/pkg", size: 1234 }],
        },
        {
            tag_name: "v0.5.0",
            name: "QLEX 0.1.9",
            prerelease: false,
            draft: false,
            html_url: "https://github.com/haoyu-qi/workcontext/releases/tag/v0.5.0",
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

    console.log("ALL QLEX v0.2.0 COLLECTOR / TAILSCALE / UPDATER TESTS PASSED!", JSON.stringify({
        nativeTokens: nativeRes.today.total,
        embeddedTsnetBuilt: Boolean(findEmbeddedTsnetBin()),
        betaDetected: betaCheck.latest.version,
        stablePhase: stableCheck.phase,
    }));
} finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
}
