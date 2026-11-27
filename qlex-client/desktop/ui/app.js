"use strict";

/* QLEX v0.3 Widescreen Controller — Q / L / E / X Vertical Rail + Orbital Core */

const shell = document.querySelector("#shell");
const closeButton = document.querySelector("#closeButton");
const minButton = document.querySelector("#minButton");
const pinButton = document.querySelector("#pinButton");
const liveDot = document.querySelector("#liveDot");
const rolePill = document.querySelector("#rolePill");
const topbarStatusPill = document.querySelector("#topbarStatusPill");
const topbarStatusDot = document.querySelector("#topbarStatusDot");
const topbarStatusText = document.querySelector("#topbarStatusText");
const syncStatusBtn = document.querySelector("#syncStatusBtn");
const syncRingGlyph = document.querySelector("#syncRingGlyph");
const syncStatusText = document.querySelector("#syncStatusText");
const updatePillBtn = document.querySelector("#updatePillBtn");
const updatePillText = document.querySelector("#updatePillText");
const qlexRail = document.querySelector("#qlexRail");
const railWorkspaceBadge = document.querySelector("#railWorkspaceBadge");
const onboardingPanel = document.querySelector("#onboardingPanel");
const overviewStage = document.querySelector("#overviewStage");
const linkStage = document.querySelector("#linkStage");
const memoryStage = document.querySelector("#memoryStage");
const workspaceStage = document.querySelector("#workspaceStage");
const statusStage = document.querySelector("#statusStage");
const insightsStage = document.querySelector("#insightsStage");
const settingsStage = document.querySelector("#settingsStage");
const noticeEl = document.querySelector("#notice");

const SOURCE_NAMES = {
    antigravity: "Antigravity",
    codex: "Codex",
    claude: "Claude Code",
    hermes: "Hermes",
    dsh: "DSH",
    workbuddy: "WorkBuddy",
    zcode: "ZCode",
    t3code: "T3 Code",
};
const ROLES = { local: "单机模式", center: "中心点", endpoint: "接入点" };
const PERIODS = { 1: "今日", 7: "近 7 天", 30: "近 30 天" };
const SECTION_LABELS = {
    overview: "中枢总览",
    link: "互联与穿透",
    memory: "记忆与图谱",
    workspace: "项目与技能",
    status: "运行状态",
    insights: "辅助洞察",
    settings: "工作台设置",
};

let state = null;
let activeSection = "overview"; // "overview" | "link" | "memory" | "workspace" | "status" | "insights" | "settings"
let insightsTab = "usage"; // "usage" | "limits" | "sessions" | "trends"
let period = 7;
let busy = false;
let refreshing = false;
let joining = false;
let invitationAddress = "";
let projectQuery = "";
let skillFilterTab = "all"; // "all" | "user" | "bundled" | "webui" | "excluded"
let skillFilterQuery = "";
let editingProject = "";
let projectDetail = "";
let sessionSource = "";
let sessionLimit = 60;
let memoryCategory = "daily";
let memoryPreview = null;
let memoryRecallQuery = "";
let memoryRecallLevel = "L1";
let memoryRecallLayer = "all";
let memoryRecallBudget = 0;
let memoryRecallResult = null;
let memoryRetainOpen = false;
let memoryLlmConfigOpen = false;
let noticeTimer = null;
let pendingDestination = null;
let lastAppearanceFp = "";
let lastMaterialFp = "";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtNum = (v) => v == null ? "—" : new Intl.NumberFormat("zh-CN").format(Math.round(v));
const fmtCompact = (v) => v == null || v < 1000 ? String(v || 0) : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const fmtBytes = (b) => {
    if (!b) return "0 B";
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
};
const fmtTime = (v) => v ? new Date(v).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtShortTime = (v) => v ? new Date(v).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "待同步";
const cleanHost = (h) => String(h || "").replace(/\.local$/i, "");
const sourceColor = (src) => window.QlexTheme?.SOURCE_COLORS?.[src] || "var(--blue)";
const projectName = (dir) => {
    const clean = String(dir || "").replace(/[\\/]+$/, "");
    const parts = clean.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || clean || "未命名工作区";
};

function patchHtml(el, html) {
    if (!el || el.__qlexHtml === html) return;
    el.__qlexHtml = html;
    el.innerHTML = html;
}

function setVisible(el, visible) {
    if (el) el.classList.toggle("hidden", !visible);
}

function notify(text, duration = 3200) {
    clearTimeout(noticeTimer);
    if (!text) {
        noticeEl.classList.add("hidden");
        noticeEl.textContent = "";
        return;
    }
    noticeEl.textContent = text;
    noticeEl.classList.remove("hidden");
    if (duration > 0) {
        noticeTimer = setTimeout(() => noticeEl.classList.add("hidden"), duration);
    }
}

function selectedReport() {
    if (!state?.usage) return null;
    if (period === 1) return state.usage.today;
    if (period === 7) return state.usage.week;
    return state.usage.history?.[period] || state.usage.week;
}

function computeHealth(st) {
    let score = 100;
    const net = st.pairing || { mode: "local" };
    const sk = st.skills || {};
    const ts = st.tailscale || {};
    const mem = st.memoryArchive || {};
    const ms = st.memorySkill || {};

    if (st.syncStatus?.phase === "error") score -= 22;
    if (sk.conflicts > 0) score -= Math.min(20, sk.conflicts * 5);
    if (sk.missingLinks > 0) score -= Math.min(8, Math.ceil(sk.missingLinks / 10));
    if (net.mode !== "local" && !net.online) score -= 18;
    if (net.mode === "center" && (net.peers || []).some(p => p.status === "pending")) score -= 4;
    if ((ms.installedCount || 0) < (ms.totalCount || 6)) score -= 6;
    if ((mem.counts?.daily || 0) === 0 && (mem.cognitive?.activeItems || 0) === 0) score -= 5;
    if (!ts.online) score -= 3;

    score = Math.max(40, Math.min(100, score));
    const phase = st.syncStatus?.phase === "syncing" ? "syncing"
        : score >= 90 ? "ok"
        : score >= 75 ? "warn" : "error";
    const label = phase === "syncing" ? "双向同步中"
        : score >= 94 ? "状态极佳"
        : score >= 82 ? "运行良好"
        : sk.conflicts > 0 ? `存在 ${sk.conflicts} 项技能冲突` : "建议检查连接";
    return { score, phase, label };
}

function syncGlyphSvg(phase) {
    if (phase === "syncing") {
        return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-opacity="0.2" stroke-width="2"/><circle class="sync-eclipse-arc" cx="12" cy="12" r="8"/></svg>`;
    }
    if (phase === "synced") {
        return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-opacity="0.3" stroke-width="1.8"/><path d="M7.5 12.4 10.6 15.4 16.8 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    if (phase === "conflict" || phase === "pending") {
        return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v4.5M12 15.8h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24"><path d="M19 8a7.5 7.5 0 0 0-12-1L4 10m0 0V5m0 5h5m-4 6a7.5 7.5 0 0 0 12 1l3-3m0 0v5m0-5h-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function updateTopbarAndRail() {
    const net = state.pairing || { mode: "local", peers: [] };
    const st = state.syncStatus || { phase: "idle", label: "立即同步", detail: "" };
    const sk = state.skills || {};
    const upd = state.updater || {};

    liveDot.classList.remove("live", "pending");
    if (net.mode === "center") liveDot.classList.add(net.online ? "live" : "pending");
    else if (net.mode === "endpoint") liveDot.classList.add(net.online && net.endpoint?.status === "connected" ? "live" : "pending");
    else liveDot.classList.add("live");

    setVisible(rolePill, state.configured);
    rolePill.textContent = ROLES[net.mode] || "单机模式";
    pinButton.classList.toggle("active", Boolean(state.appearance?.alwaysOnTop));

    setVisible(topbarStatusPill, state.configured);
    topbarStatusText.textContent = SECTION_LABELS[activeSection] || "中枢总览";
    topbarStatusDot.className = `status-pulse${st.phase === "syncing" ? " syncing" : (sk.conflicts > 0 || (net.mode !== "local" && !net.online)) ? " warn" : ""}`;

    setVisible(syncStatusBtn, state.configured);
    syncStatusBtn.className = `sync-pill phase-${st.phase}`;
    syncStatusBtn.disabled = st.phase === "syncing";
    syncRingGlyph.innerHTML = syncGlyphSvg(st.phase);
    syncStatusText.textContent = st.label || "立即同步";
    syncStatusBtn.title = st.detail || "立即执行全量双向同步";

    const hasUpdate = ["available", "downloading", "verifying", "ready", "installing"].includes(upd.phase);
    updatePillBtn.classList.toggle("has-update", hasUpdate);
    updatePillText.textContent = upd.phase === "installing"
        ? "更新重启中…"
        : upd.phase === "ready"
            ? `更新重启 ${upd.latest?.version || ""}`
            : upd.phase === "verifying"
                ? "校验安装包…"
                : upd.phase === "downloading"
                    ? `下载中 ${upd.progress || 0}%`
                    : upd.phase === "available"
                        ? `更新 ${upd.latest?.version || ""}`
                        : `v${state.version || "0.3.0"}`;

    setVisible(qlexRail, state.configured);
    for (const btn of qlexRail.querySelectorAll(".nav-capsule-btn, .rail-aux-btn")) {
        btn.classList.toggle("active", btn.dataset.rail === activeSection);
    }
    const workspaceAlerts = (sk.conflicts || 0) + (state.remoteProjects?.length || 0);
    setVisible(railWorkspaceBadge, workspaceAlerts > 0);
    if (workspaceAlerts > 0) railWorkspaceBadge.textContent = String(workspaceAlerts);
}

/* ---- Onboarding ---- */
function renderOnboarding() {
    patchHtml(onboardingPanel, `
      <div class="onboarding-card">
        <div style="display:flex;align-items:center;gap:12px">
          <img src="../../docs/assets/brand/logo.svg" alt="QLEX" style="width:46px;height:46px;border-radius:50%" />
          <div>
            <h1 style="margin:0;font-size:20px;color:var(--number)">欢迎使用 QLEX</h1>
            <div class="muted-note">总览 · 互联 · 记忆 · 工程 · 状态 — 多端 AI 工作台互联中枢</div>
          </div>
        </div>
        <div class="item-list">
          <label class="mode-option">
            <input type="radio" name="mode" value="center" checked />
            <span><strong>设为中心点（推荐主力机 / Mac mini）</strong><small>启动自签 TLS 同步中心，生成一次性邀请码，双向同步记忆、项目目录与 6 工具 Skills。</small></span>
          </label>
          <label class="mode-option">
            <input type="radio" name="mode" value="endpoint" />
            <span><strong>作为接入点加入中心</strong><small>粘贴中心设备的一次性配对邀请，或通过 Tailscale 内网直连加入。</small></span>
          </label>
          <label class="mode-option">
            <input type="radio" name="mode" value="local" />
            <span><strong>暂仅本机使用</strong><small>先在本机运行认知记忆引擎、项目工作区与 6 工具 Skills 一致化，随时可在「互联」中切换。</small></span>
          </label>
        </div>
        <div id="onboardingInviteBox" class="hidden">
          <textarea id="invite" class="glass-textarea" maxlength="4200" spellcheck="false" placeholder="在中心设备复制配对邀请后粘贴到这里…"></textarea>
        </div>
        <div style="display:flex;justify-content:flex-end">
          <button class="q-primary-cta" style="min-width:150px;height:36px" type="button" data-action="continue">进入 QLEX 工作台</button>
        </div>
      </div>
    `);
}

/* ---- 7-Day Compact Trend Chart for Q Stage ---- */
function buildQTrendSvg() {
    const memDaily = state.memoryArchive?.items?.daily || [];
    const memMap = new Map(memDaily.map(item => [item.key, Number(item.rawBytes || item.compressedBytes || 0)]));
    const usageDaily = state.usage?.week?.daily || state.usage?.history?.[7]?.daily || [];
    const usageMap = new Map(usageDaily.map(r => [r.date, Number(r.tokens || 0)]));
    const todayTotal = Number(state.usage?.today?.total || 0);

    const end = new Date();
    const days = Array.from({ length: 7 }, (_, idx) => {
        const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (6 - idx));
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return { key, short: key.slice(5), memVal: memMap.get(key) || 0, tokVal: usageMap.get(key) ?? (idx === 6 ? todayTotal : 0) };
    });

    const maxMem = Math.max(1, ...days.map(d => d.memVal));
    const maxTok = Math.max(1, ...days.map(d => d.tokVal));
    const W = 240, H = 52, top = 6, base = 46, plotH = base - top, step = W / 7, barW = 12;

    const bars = days.map((d, i) => {
        const cx = step * (i + 0.5);
        const bh = d.memVal > 0 ? Math.max(4, Math.round((d.memVal / maxMem) * (plotH * 0.85))) : 2;
        return `<rect x="${(cx - barW / 2).toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${barW}" height="${bh}" rx="2.5" fill="var(--accent)" fill-opacity="${d.memVal > 0 ? 0.72 : 0.16}"><title>${d.key} · 记忆 ${fmtBytes(d.memVal)}</title></rect>`;
    }).join("");

    const pts = days.map((d, i) => {
        const x = step * (i + 0.5);
        const ratio = d.tokVal > 0 ? Math.max(0.1, d.tokVal / maxTok) : 0;
        return { x, y: base - ratio * (plotH * 0.9), d };
    });
    const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const dots = pts.map(p => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.d.tokVal > 0 ? 2.4 : 1.5}" fill="var(--blue)"><title>${p.d.key} · 活动 ${fmtNum(p.d.tokVal)}</title></circle>`).join("");

    return `
      <svg class="q-trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="rgba(232,238,244,0.12)" stroke-width="1"/>
        ${bars}
        <path d="${line}" fill="none" stroke="var(--blue)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}
      </svg>
      <div class="q-trend-axis">${days.map(d => `<span>${d.short}</span>`).join("")}</div>
    `;
}

/* ---- Overview Stage: Constellation Orbital Hub + Right Live Telemetry Rail ---- */
function buildRightBarChartSvg() {
    const usageDaily = state.usage?.week?.daily || state.usage?.history?.[7]?.daily || [];
    const usageMap = new Map(usageDaily.map(r => [r.date, Number(r.tokens || 0)]));
    const memDaily = state.memoryArchive?.items?.daily || [];
    const memMap = new Map(memDaily.map(item => [item.key, Number(item.rawBytes || item.compressedBytes || 0)]));
    const todayTotal = Number(state.usage?.today?.total || 0);

    const end = new Date();
    const days = Array.from({ length: 7 }, (_, idx) => {
        const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (6 - idx));
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const tok = usageMap.get(key) ?? (idx === 6 ? todayTotal : 0);
        const mem = memMap.get(key) || 0;
        return { key, short: key.slice(5), val: tok || mem, tok, mem };
    });

    const maxV = Math.max(1, ...days.map(d => d.val));
    const W = 250, H = 64, top = 6, base = 58, plotH = base - top, step = W / 7, barW = 14;
    const bars = days.map((d, i) => {
        const cx = step * (i + 0.5);
        const bh = d.val > 0 ? Math.max(5, Math.round((d.val / maxV) * plotH)) : 3;
        return `<rect x="${(cx - barW / 2).toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${barW}" height="${bh}" rx="3.5" fill="var(--accent)" fill-opacity="${d.val > 0 ? 0.85 : 0.16}"><title>${d.key} · 活动 ${fmtNum(d.tok)} tok / 记忆 ${fmtBytes(d.mem)}</title></rect>`;
    }).join("");

    return `
      <svg class="q-trend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <line x1="0" y1="${top + plotH * 0.5}" x2="${W}" y2="${top + plotH * 0.5}" stroke="rgba(232,238,244,0.07)" stroke-width="1"/>
        <line x1="0" y1="${base}" x2="${W}" y2="${base}" stroke="rgba(232,238,244,0.12)" stroke-width="1"/>
        ${bars}
      </svg>
      <div class="q-trend-axis">${days.map(d => `<span>${d.short}</span>`).join("")}</div>
    `;
}

function renderQStage() {
    const net = state.pairing || { mode: "local", peers: [] };
    const ts = state.tailscale || {};
    const sk = state.skills || {};
    const mem = state.memoryArchive || {};
    const cog = mem.cognitive || { activeItems: 0, entities: 0, activeEdges: 0 };
    const counts = mem.counts || { daily: 0, weekly: 0, monthly: 0 };
    const ms = state.memorySkill || { installedCount: 0, totalCount: 9 };
    const st = state.syncStatus || { phase: "idle", label: "立即同步", time: 0 };
    const health = computeHealth(state);
    const connectedPeers = (net.peers || []).filter(p => p.status === "connected").length;
    const onlinePeers = (net.peers || []).filter(p => p.online).length;
    const boundProjects = state.projects || [];
    const remoteProjects = state.remoteProjects || [];
    const anomalies = sk.anomalies || [];
    const weekTotal = Number(state.usage?.week?.total || 0);
    const isSyncing = st.phase === "syncing";
    const orbTone = health.phase === "warn" || health.phase === "error" ? "warn" : "";

    const activeNodeLabel = net.mode === "center"
        ? `中心点：${cleanHost(state.deviceName)}`
        : net.mode === "endpoint"
            ? `接入点：${cleanHost(net.endpoint?.name || net.endpoint?.address || "中心节点")}`
            : `单机中枢：${cleanHost(state.deviceName)}`;
    const nodeOnlineBadge = net.mode === "local" ? "就绪" : net.online ? "在线" : "离线";

    const memBars = (mem.items?.daily || []).slice(0, 7).reverse();
    const memHeights = Array.from({ length: 7 }, (_, i) => {
        const it = memBars[i];
        return it ? Math.max(25, Math.min(100, Math.round((Number(it.rawBytes || 2000) / 28000) * 100))) : 16;
    });
    const skillHeights = Object.values(sk.namespaces || {}).slice(0, 7).map(n => Math.max(20, Math.min(100, Math.round(((n.count || 0) / Math.max(1, sk.uniqueSkills || 1)) * 100))));
    while (skillHeights.length < 7) skillHeights.push(20);

    const recentFeed = [];
    const projSync = net.syncMeta?.lastProjectsSync || net.syncMeta?.lastProjectSync;
    if (projSync?.error) recentFeed.push({ icon: "!", text: `项目同步异常：${projSync.error}`, time: fmtShortTime(projSync.time) });
    else if (boundProjects[0]) recentFeed.push({ icon: "✓", text: `同步项目：${boundProjects[0].name}${boundProjects[0].gitBranch ? ` (${boundProjects[0].gitBranch})` : ""}`, time: fmtShortTime(projSync?.time || boundProjects[0].lastSyncedAt || boundProjects[0].updatedAt) });
    if (sk.localTime) recentFeed.push({ icon: sk.conflicts > 0 ? "!" : "✓", text: sk.conflicts > 0 ? `技能存在 ${sk.conflicts} 项冲突待对齐` : `技能一致化：${sk.uniqueSkills ?? 0} 项已对齐`, time: fmtShortTime(sk.localTime) });
    if (mem.items?.daily?.[0]) recentFeed.push({ icon: "⟳", text: `记忆归档：${mem.items.daily[0].key}（${cog.activeItems || 0} 条）`, time: fmtShortTime(mem.lastRun) });
    if (remoteProjects.length) recentFeed.push({ icon: "↓", text: `远端待绑定项目：${remoteProjects.length} 个`, time: fmtShortTime(projSync?.time) });
    recentFeed.push({ icon: ts.online ? "✓" : "•", text: ts.online ? `穿透在线：${ts.self?.dnsName || ts.self?.ip}` : `本机节点：${cleanHost(state.deviceName)}`, time: fmtShortTime(st.time) });

    const issueCount = (sk.conflicts || 0) + anomalies.length;

    patchHtml(overviewStage, `
      <div class="hub-left-main">
        <div class="hub-title-row">
          <h1>中枢总览</h1>
          <p>项目同步 · 持久记忆 · 跨设备工作空间 · 多工具统一 Skills</p>
        </div>

        <section class="hub-constellation">
          <svg class="hub-links-svg" viewBox="0 0 600 266" preserveAspectRatio="none" aria-hidden="true">
            <line x1="184" y1="96" x2="226" y2="112" stroke="rgba(183,234,212,0.38)" stroke-width="1.2" stroke-dasharray="3 3"/>
            <line x1="184" y1="170" x2="226" y2="154" stroke="rgba(183,234,212,0.38)" stroke-width="1.2" stroke-dasharray="3 3"/>
            <line x1="416" y1="96" x2="374" y2="112" stroke="rgba(115,189,245,0.38)" stroke-width="1.2" stroke-dasharray="3 3"/>
            <line x1="416" y1="170" x2="374" y2="154" stroke="rgba(115,189,245,0.38)" stroke-width="1.2" stroke-dasharray="3 3"/>
            <circle cx="226" cy="112" r="2.5" fill="var(--accent)"/>
            <circle cx="226" cy="154" r="2.5" fill="var(--accent)"/>
            <circle cx="374" cy="112" r="2.5" fill="var(--blue)"/>
            <circle cx="374" cy="154" r="2.5" fill="var(--blue)"/>
          </svg>

          <div class="hub-sat-col">
            <button type="button" class="hub-sat-card" data-rail="link">
              <span class="hub-sat-ico blue">⌘</span>
              <div class="hub-sat-text">
                <div class="hub-sat-title">设备互联</div>
                <div class="hub-sat-sub"><span class="hub-sat-dot ${net.online || ts.online ? "" : "warn"}"></span>${net.mode === "center" ? `${onlinePeers}/${connectedPeers} 节点 · 在线` : ts.online ? `${(ts.discoveredCenters || []).length} 台中心 · 穿透` : "单机就绪"}</div>
              </div>
            </button>
            <button type="button" class="hub-sat-card" data-rail="memory">
              <span class="hub-sat-ico purple">✦</span>
              <div class="hub-sat-text">
                <div class="hub-sat-title">持久记忆</div>
                <div class="hub-sat-sub"><span class="hub-sat-dot"></span>${fmtNum(cog.activeItems || 0)} 条活跃记忆</div>
              </div>
            </button>
          </div>

          <div class="hub-orb-wrap ${isSyncing ? "syncing" : ""} ${orbTone ? "warn-tone" : ""}">
            <span class="solar-star" style="width:2.5px;height:2.5px;top:14%;left:18%;animation-delay:0s"></span>
            <span class="solar-star" style="width:2px;height:2px;top:20%;right:14%;animation-delay:1.4s"></span>
            <span class="solar-star" style="width:2.5px;height:2.5px;bottom:16%;left:22%;animation-delay:2.6s"></span>
            <span class="solar-star" style="width:2px;height:2px;bottom:12%;right:20%;animation-delay:0.8s"></span>

            <div class="solar-orbit orbit-3" aria-hidden="true">
              <span class="orbit-body planet-purple"></span>
              <span class="orbit-body moon-amber"></span>
            </div>
            <div class="solar-orbit orbit-2" aria-hidden="true">
              <span class="orbit-body planet-blue"></span>
            </div>
            <div class="solar-orbit orbit-1" aria-hidden="true">
              <span class="orbit-body moon-mint"></span>
            </div>
            <div class="planet-halo-ring" aria-hidden="true"></div>

            <button type="button" class="q-core-orb ${orbTone}" data-action="sync-now" title="点击立即执行双向同步">
              <svg class="orb-grid" viewBox="0 0 140 140" aria-hidden="true">
                <circle cx="70" cy="70" r="68" fill="none" stroke="white" stroke-width="0.7"/>
                <ellipse cx="70" cy="70" rx="34" ry="68" fill="none" stroke="white" stroke-width="0.7"/>
                <ellipse cx="70" cy="70" rx="68" ry="24" fill="none" stroke="white" stroke-width="0.7"/>
                <line x1="2" y1="70" x2="138" y2="70" stroke="white" stroke-width="0.6"/>
              </svg>
              <span class="q-core-score">${health.score}</span>
              <span class="q-core-tag">${health.phase === "ok" ? "✓ " : "⚠ "}${esc(health.label)}</span>
            </button>
          </div>

          <div class="hub-sat-col">
            <button type="button" class="hub-sat-card" data-rail="workspace">
              <span class="hub-sat-ico">❖</span>
              <div class="hub-sat-text">
                <div class="hub-sat-title">工程同步</div>
                <div class="hub-sat-sub"><span class="hub-sat-dot ${issueCount > 0 ? "warn" : ""}"></span>${boundProjects.length} 项目 · ${sk.uniqueSkills ?? 0} Skills</div>
              </div>
            </button>
            <button type="button" class="hub-sat-card" data-rail="status">
              <span class="hub-sat-ico ${issueCount > 0 ? "warn" : "blue"}">◎</span>
              <div class="hub-sat-text">
                <div class="hub-sat-title">AI 工具</div>
                <div class="hub-sat-sub"><span class="hub-sat-dot ${issueCount > 0 ? "warn" : ""}"></span>${ms.installedCount}/${ms.totalCount} 工具 · ${issueCount > 0 ? `${issueCount} 项待处理` : "已对齐"}</div>
              </div>
            </button>
          </div>
        </section>

        <div class="hub-node-banner">
          <div class="hub-node-line">
            <span>${esc(activeNodeLabel)}</span>
            <span class="tag ${net.online || net.mode === "local" ? "ok" : "warn"}">${nodeOnlineBadge}</span>
          </div>
          <div class="hub-node-sub">
            <span>${fmtNum(cog.activeItems || 0)} 条记忆 · ${sk.uniqueSkills ?? 0} 项技能 · ${ts.online ? `Tailscale ${esc(ts.self?.ip || "")}` : "局域网"}</span>
            <span>·</span>
            ${issueCount > 0
                ? `<button type="button" class="q-inline-link" style="color:var(--orange)" data-rail="workspace">处理 ${issueCount} 项冲突/异常 ›</button>`
                : net.mode === "center" && net.online
                    ? `<button type="button" class="q-inline-link" data-action="copy-invite">复制邀请码</button><span>·</span><button type="button" class="q-inline-link" data-action="invite">刷新链接</button>`
                    : `<button type="button" class="q-inline-link" data-action="tailscale-scan">扫描内网节点 ›</button>`}
          </div>
        </div>

        <section class="hub-mini-grid">
          <div class="hub-mini-card" data-rail="link">
            <div class="hub-mini-lbl">设备连接</div>
            <div class="hub-mini-val">${net.mode === "center" ? `${onlinePeers}<small>台在线</small>` : `${(ts.discoveredCenters || []).length}<small>台中心</small>`}</div>
            <svg class="hub-mini-spark" viewBox="0 0 100 22" preserveAspectRatio="none">
              <path d="M0 18 L18 14 L34 16 L52 10 L70 13 L86 7 L100 9" fill="none" stroke="var(--accent)" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="hub-mini-card" data-rail="memory">
            <div class="hub-mini-lbl">活跃记忆</div>
            <div class="hub-mini-val">${fmtNum(cog.activeItems || 0)}<small>条</small></div>
            <div class="hub-mini-bars">${memHeights.map(h => `<span class="hub-mini-bar purple" style="height:${h}%"></span>`).join("")}</div>
          </div>
          <div class="hub-mini-card" data-rail="workspace">
            <div class="hub-mini-lbl">项目与技能</div>
            <div class="hub-mini-val">${boundProjects.length}<small>项 · ${sk.uniqueSkills ?? 0}技</small></div>
            <div class="hub-mini-bars">${skillHeights.map(h => `<span class="hub-mini-bar blue" style="height:${h}%"></span>`).join("")}</div>
          </div>
          <div class="hub-mini-card" data-rail="status">
            <div class="hub-mini-lbl">归档覆盖</div>
            <div class="hub-mini-val">${counts.daily}<small>日 / ${mem.compressionRatio ?? 0}%</small></div>
            <div class="hub-mini-bars">${[28, 42, 35, 62, 54, 78, 92].map(h => `<span class="hub-mini-bar" style="height:${h}%"></span>`).join("")}</div>
          </div>
        </section>
      </div>

      <aside class="hub-right-rail">
        <div class="hub-right-card">
          <div class="card-head">
            <span class="card-title">系统状态</span>
            <span class="tag ${health.phase === "ok" ? "ok" : "warn"}">${health.phase === "ok" ? "✓ 运行正常" : "待处理"}</span>
          </div>
          <div>
            <div class="hub-check-row"><span class="hub-check-left"><span class="hub-sat-dot"></span>同步服务</span><span class="hub-check-val">${net.online || net.mode === "local" ? "正常" : "离线"}</span></div>
            <div class="hub-check-row"><span class="hub-check-left"><span class="hub-sat-dot"></span>记忆引擎</span><span class="hub-check-val">压缩 ${mem.compressionRatio ?? 0}%</span></div>
            <div class="hub-check-row"><span class="hub-check-left"><span class="hub-sat-dot ${ts.online ? "" : "warn"}"></span>跨设备穿透 (Tailscale)</span><span class="hub-check-val ${ts.online ? "" : "warn"}">${ts.online ? "在线" : "未连接"}</span></div>
            <div class="hub-check-row"><span class="hub-check-left"><span class="hub-sat-dot ${issueCount > 0 ? "warn" : ""}"></span>AI 工具对齐</span><span class="hub-check-val ${issueCount > 0 ? "warn" : ""}">${issueCount > 0 ? `${issueCount} 项待处理` : "已就绪"}</span></div>
          </div>
        </div>

        <div class="hub-right-card" data-rail="insights" style="cursor:pointer">
          <div class="card-head">
            <span class="card-title">活动趋势 <small style="font-weight:500;color:var(--muted)">(辅助统计)</small></span>
            <span class="tag">近 7 天</span>
          </div>
          <div style="display:flex;align-items:baseline;justify-content:space-between">
            <strong style="font-size:18px;color:var(--number);font-variant-numeric:tabular-nums">${fmtCompact(weekTotal)} <small style="font-size:11px;font-weight:500;color:var(--muted)">tokens</small></strong>
            <span class="card-meta">${Object.values(state.usage?.diagnostics || {}).filter(d => d.status === "ok").length}/8 工具活跃</span>
          </div>
          ${buildRightBarChartSvg()}
        </div>

        <div class="hub-right-card grow">
          <div class="card-head">
            <span class="card-title">最近同步活动</span>
            <button type="button" class="q-inline-link" data-rail="status">查看全部 ›</button>
          </div>
          <div>
            ${recentFeed.slice(0, 5).map(f => `
              <div class="hub-feed-row">
                <span class="hub-feed-text">${esc(f.icon)} ${esc(f.text)}</span>
                <span class="hub-feed-time">${esc(f.time)}</span>
              </div>
            `).join("")}
          </div>
        </div>
      </aside>

      <footer class="hub-quick-dock">
        <span class="hub-quick-label">⚡ 快速操作</span>
        <div class="hub-quick-btns">
          <button type="button" class="hub-quick-btn primary" data-action="sync-now" ${isSyncing ? "disabled" : ""}>${isSyncing ? "⟳ 同步中…" : "⟳ 立即同步"}</button>
          <button type="button" class="hub-quick-btn" data-action="add-project">+ 添加项目</button>
          <button type="button" class="hub-quick-btn" data-action="quick-write-memory">✎ 写入记忆</button>
          <button type="button" class="hub-quick-btn" data-action="sync-local-skills">⇄ 对齐 Skills</button>
          <button type="button" class="hub-quick-btn" data-rail="link">⊕ 连接新设备</button>
        </div>
      </footer>
    `);
}

/* ---- L Stage: Link (Center/Endpoint, Invite, Tailscale Mesh) ---- */
function renderLStage() {
    const net = state.pairing || { mode: "local", peers: [] };
    const ts = state.tailscale || { mode: "unavailable", online: false, self: {}, tailnetPeers: [], discoveredCenters: [] };
    const isCenter = net.mode === "center";
    const isEndpoint = net.mode === "endpoint";
    const syncMeta = net.syncMeta || {};

    let roleBody = "";
    if (isCenter) {
        const entries = net.addressEntries?.length ? net.addressEntries : (net.addresses || []).map(a => ({ host: a, label: a }));
        if (!invitationAddress || !entries.some(e => e.host === invitationAddress)) {
            invitationAddress = net.activeInvite?.host || entries[0]?.host || "";
        }
        const inv = net.activeInvite;
        const remainMin = inv ? Math.max(1, Math.ceil((inv.expiresAt - Date.now()) / 60_000)) : 0;
        roleBody = `
          <div class="muted-note">选择供接入设备连接的本机地址（TLS 端口 ${net.port}）</div>
          <select id="centerAddress" class="glass-select" ${entries.length ? "" : "disabled"}>
            ${entries.length ? entries.map(e => `<option value="${esc(e.host)}" ${e.host === invitationAddress ? "selected" : ""}>${esc(e.label)}</option>`).join("") : "<option>无可用网络地址</option>"}
          </select>
          ${inv ? `
            <div class="invite-box">
              <div class="card-head">
                <span class="card-title" style="font-size:12px">一次性邀请码 · #${esc(inv.shortToken)}</span>
                <span class="tag ok">剩 ${remainMin} 分钟</span>
              </div>
              <div class="mono-line">接入地址：${esc(inv.host)}:${inv.port}</div>
              <div class="invite-code-mono" title="${esc(inv.code)}">${esc(inv.code)}</div>
              <div class="btn-grid-2">
                <button type="button" class="glass-btn primary" data-action="copy-invite">复制邀请码</button>
                <button type="button" class="glass-btn" data-action="invite">⟳ 刷新邀请链接</button>
              </div>
            </div>
          ` : `
            <div class="btn-row">
              <button type="button" class="glass-btn primary" data-action="invite" ${entries.length && net.online ? "" : "disabled"}>生成并复制邀请码</button>
              ${!net.online ? `<button type="button" class="glass-btn primary" data-action="enable-center">重试启动中心</button>` : ""}
            </div>
          `}
          <div class="btn-row" style="justify-content:flex-end">
            <button type="button" class="glass-btn sm danger" data-action="use-local">停止中心并切回单机</button>
          </div>
        `;
    } else if (isEndpoint) {
        roleBody = `
          <div class="item-row">
            <div class="item-main">
              <span class="item-dot" style="background:${net.online ? "var(--success)" : "var(--orange)"}"></span>
              <div class="item-text">
                <div class="item-title">已连接中心：${esc(cleanHost(net.endpoint?.name || net.endpoint?.address || "中心节点"))}</div>
                <div class="item-sub">${esc(net.endpoint?.address || "")}${net.endpoint?.status === "pending" ? ` · 核对码 ${esc(net.endpoint.check)}` : ""}</div>
              </div>
            </div>
            <span class="tag ${net.online ? "ok" : "warn"}">${net.endpoint?.status === "pending" ? "待确认" : net.online ? "在线" : "离线"}</span>
          </div>
          <div class="btn-row">
            <button type="button" class="glass-btn primary" data-action="sync-now">⟳ 立即双向同步</button>
            <button type="button" class="glass-btn" data-action="refresh-pairing">刷新连接</button>
            <button type="button" class="glass-btn danger" data-action="use-local">退出中心</button>
          </div>
        `;
    } else {
        roleBody = joining ? `
          <textarea id="invite" class="glass-textarea" placeholder="粘贴中心设备生成的一次性配对邀请码…"></textarea>
          <div class="btn-row">
            <button type="button" class="glass-btn primary" data-action="submit-invite">提交配对请求</button>
            <button type="button" class="glass-btn" data-action="cancel-join">取消</button>
          </div>
        ` : `
          <div class="muted-note">当前处于单机模式。设为「中心点」可接纳其他 Mac/设备同步记忆与项目；或作为「接入点」加入已有中心。</div>
          <div class="btn-row">
            <button type="button" class="glass-btn primary" data-action="enable-center">设为中心点</button>
            <button type="button" class="glass-btn" data-action="show-join">作为接入点加入</button>
          </div>
        `;
    }

    const peersHtml = isCenter ? `
      <div class="card">
        <div class="card-head">
          <span class="card-title">已接入与待审批设备</span>
          <span class="card-meta">${(net.peers || []).length} 台</span>
        </div>
        ${(net.peers || []).length ? `<div class="item-list">${net.peers.map(peer => `
          <div class="item-row">
            <div class="item-main">
              <span class="item-dot" style="background:${peer.status === "pending" ? "var(--orange)" : peer.online ? "var(--success)" : "var(--muted)"}"></span>
              <div class="item-text">
                <div class="item-title">${esc(cleanHost(peer.name))}</div>
                <div class="item-sub">${peer.status === "pending" ? `核对码 ${esc(peer.check)} · 等待批准` : peer.online ? "在线 · 双向同步已连通" : "离线"}</div>
              </div>
            </div>
            <div class="btn-row">
              ${peer.status === "pending" ? `<button type="button" class="glass-btn sm primary" data-action="approve" data-id="${esc(peer.id)}">批准</button>` : ""}
              <button type="button" class="glass-btn sm danger" data-action="remove" data-id="${esc(peer.id)}">${peer.status === "pending" ? "拒绝" : "撤销"}</button>
            </div>
          </div>
        `).join("")}</div>` : `<div class="empty-state" style="padding:14px 8px">暂无接入设备。复制左侧一次性邀请码到另一台电脑粘贴即可接入。</div>`}
      </div>
    ` : "";

    const tsBadge = ts.mode === "system" && ts.online ? "系统 Tailscale 在线"
        : ts.mode === "embedded" && ts.online ? "内嵌 tsnet SDK 在线"
        : ts.embeddedRunning ? (ts.authURL ? "等待浏览器登录" : "启动中…") : "未连接";

    patchHtml(linkStage, `
      <div class="stage-header">
        <div class="stage-title-group">
          <h2 class="stage-title">互联与穿透</h2>
          <span class="stage-subtitle">中心点 / 接入点配对 · 一次性邀请码 · Tailscale 内网穿透与自动发现</span>
        </div>
        <div class="stage-actions">
          <button type="button" class="glass-btn sm" data-action="tailscale-scan">⟳ 扫描内网设备</button>
          <button type="button" class="glass-btn sm primary" data-action="sync-now">立即同步</button>
        </div>
      </div>

      <div class="split-cols wide-left">
        <div class="col-stack">
          <div class="card">
            <div class="card-head">
              <span class="card-title">${esc(cleanHost(state.deviceName))} · ${ROLES[net.mode]}</span>
              <span class="tag ${net.online || net.mode === "local" ? "ok" : "warn"}">${isCenter ? (net.online ? "运行中" : "未启动") : isEndpoint ? (net.online ? "已连接" : "离线") : "单机"}</span>
            </div>
            ${roleBody}
          </div>
          ${peersHtml}
        </div>

        <div class="col-stack">
          <div class="card">
            <div class="card-head">
              <span class="card-title">Tailscale 内网穿透 & 内嵌 tsnet SDK</span>
              <span class="tag ${ts.online ? "ok" : "warn"}">${tsBadge}</span>
            </div>
            <div class="muted-note">
              ${ts.self?.ip ? `本机 Tailnet：<strong>${esc(ts.self.ip)}</strong>${ts.self.dnsName ? ` · ${esc(ts.self.dnsName)}` : ""}` : "自动接管系统 Tailscale，或一键启动内嵌 Go tsnet SDK 免装客户端直连。"}
            </div>
            <div class="btn-row">
              <button type="button" class="glass-btn sm primary" data-action="tailscale-scan">⟳ 扫描内网中心</button>
              ${ts.embeddedRunning
                  ? `<button type="button" class="glass-btn sm danger" data-action="tailscale-stop-embedded">停止内嵌 SDK</button>`
                  : ts.embeddedAvailable
                      ? `<button type="button" class="glass-btn sm" data-action="tailscale-start-embedded">启动内嵌 tsnet SDK</button>`
                      : ""}
              ${ts.authURL ? `<button type="button" class="glass-btn sm primary" data-action="tailscale-open-auth">浏览器登录 ↗</button>` : ""}
            </div>
            ${(ts.discoveredCenters || []).length ? `<div class="item-list">${ts.discoveredCenters.map(p => `
              <div class="item-row">
                <div class="item-text">
                  <div class="item-title">${esc(p.name)}</div>
                  <div class="item-sub">${esc(p.dnsName || p.host)}:${p.port} · ${p.latencyMs}ms</div>
                </div>
                <span class="tag ok">${p.transport === "lan" ? "局域网" : p.transport === "tailscale-direct" ? "TS 直连" : "TS 中继"}</span>
              </div>
            `).join("")}</div>` : `<div class="muted-note">Tailnet 在线节点 ${(ts.tailnetPeers || []).filter(p => p.online).length} 台</div>`}
          </div>

          <div class="card">
            <div class="card-head">
              <span class="card-title">同步元数据与节点信息</span>
              <span class="card-meta">${state.platform === "darwin" ? "macOS" : state.platform}</span>
            </div>
            <div class="kpi-strip-3">
              <div class="kpi-chip"><span>记忆同步</span><strong>${fmtShortTime(syncMeta.lastMemorySync?.time)}</strong></div>
              <div class="kpi-chip"><span>项目同步</span><strong>${fmtShortTime(syncMeta.lastProjectsSync?.time)}</strong></div>
              <div class="kpi-chip"><span>监听端口</span><strong>${net.port || 46271}</strong></div>
            </div>
            <div class="mono-line">本机标识：${esc(state.deviceName)}</div>
          </div>
        </div>
      </div>
    `);
}

/* ---- E Stage: Engram (Cognitive Memory Engine, Graph, Recall, Reader) ---- */
function renderEStage() {
    const mem = state.memoryArchive || { counts: { daily: 0, weekly: 0, monthly: 0 }, items: { daily: [], weekly: [], monthly: [] } };
    const c = mem.counts || { daily: 0, weekly: 0, monthly: 0 };
    const cog = mem.cognitive || { activeItems: 0, supersededItems: 0, entities: 0, activeEdges: 0, historicalEdges: 0, reflectionsCount: 0 };
    const temps = cog.temperatures || { hot: 0, warm: 0, cold: 0, dormant: 0 };
    const tiers = cog.tiers || { working: 0, episodic: 0, semantic: 0, procedural: 0 };
    const ms = state.memorySkill || { installedCount: 0, totalCount: 9 };
    const list = mem.items?.[memoryCategory] || [];
    const net = state.pairing || { mode: "local" };
    const cons = mem.consolidation || { revision: 0, pendingCount: 0, pendingDevices: [], syncedCenterRevision: 0 };
    const llmCfg = state.centerMemoryLlm || { enabled: true, preset: "deepseek", provider: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", scheduleMode: "slots", timeSlots: ["12:30", "18:30", "21:30"], intervalHours: 4, onlyWhenChanged: true, configured: false, hasApiKey: false, nextTriggerLabel: "—" };
    const llmPresets = state.llmProviderPresets || {};
    const isEndpoint = net.mode === "endpoint";
    const llmTagCls = mem.phase === "consolidating" ? "blue" : isEndpoint ? (cons.syncedCenterRevision ? "ok" : "warn") : (llmCfg.configured && llmCfg.enabled ? "ok" : "warn");
    const llmTagText = mem.phase === "consolidating"
        ? "整理中…"
        : isEndpoint
            ? (cons.syncedCenterRevision ? `同步中心 #${cons.syncedCenterRevision}` : "等待中心整理")
            : (llmCfg.configured && llmCfg.enabled ? `LLM #${cons.revision || 0}` : `规则 #${cons.revision || 0}`);

    const llmConfigForm = (!isEndpoint && memoryLlmConfigOpen) ? `
      <form id="memoryLlmForm" class="card" style="background:rgba(var(--sunken-rgb),0.42)">
        <div class="card-head">
          <span class="card-title">中心大模型 API 与定时整理配置</span>
          <button type="button" class="glass-btn sm" data-action="toggle-memory-llm-config">收起</button>
        </div>
        <div class="settings-row">
          <span class="settings-label">按时间段自动整理并分发全端</span>
          <input id="llmEnabledInput" class="settings-switch" type="checkbox" ${llmCfg.enabled !== false ? "checked" : ""} />
        </div>
        <div class="settings-row">
          <span class="settings-label">仅在有新增/变更记忆时调用大模型</span>
          <input id="llmOnlyChangedInput" class="settings-switch" type="checkbox" ${llmCfg.onlyWhenChanged !== false ? "checked" : ""} />
        </div>
        <div class="btn-grid-2">
          <select id="llmPresetSelect" class="glass-select">
            ${Object.values(llmPresets).map(pr => `<option value="${esc(pr.id)}" ${llmCfg.preset === pr.id ? "selected" : ""}>${esc(pr.label)}</option>`).join("")}
          </select>
          <select id="llmProviderSelect" class="glass-select">
            <option value="openai-compatible" ${llmCfg.provider !== "anthropic" ? "selected" : ""}>OpenAI 兼容协议</option>
            <option value="anthropic" ${llmCfg.provider === "anthropic" ? "selected" : ""}>Anthropic Messages</option>
          </select>
        </div>
        <input id="llmBaseUrlInput" class="glass-input" value="${esc(llmCfg.baseUrl || "")}" placeholder="API Base URL（如 https://api.deepseek.com/v1）" />
        <div class="btn-grid-2">
          <input id="llmModelInput" class="glass-input" value="${esc(llmCfg.model || "")}" placeholder="模型名（如 deepseek-chat / gpt-4o-mini）" />
          <input id="llmApiKeyInput" class="glass-input" type="password" autocomplete="off" placeholder="${llmCfg.hasApiKey ? `已保存 ${esc(llmCfg.apiKeyPreview)}（留空不改）` : "输入 API Key（本地 Ollama 可留空）"}" />
        </div>
        <div class="btn-grid-2">
          <select id="llmScheduleModeSelect" class="glass-select">
            <option value="slots" ${llmCfg.scheduleMode !== "interval" ? "selected" : ""}>按每日时间段触发</option>
            <option value="interval" ${llmCfg.scheduleMode === "interval" ? "selected" : ""}>按固定小时间隔</option>
          </select>
          ${llmCfg.scheduleMode === "interval"
            ? `<input id="llmIntervalHoursInput" class="glass-input" type="number" min="1" max="24" value="${esc(llmCfg.intervalHours || 4)}" placeholder="间隔小时数（1-24）" />`
            : `<input id="llmTimeSlotsInput" class="glass-input" value="${esc((llmCfg.timeSlots || []).join(", "))}" placeholder="如 12:30, 18:30, 21:30" />`}
        </div>
        ${llmCfg.scheduleMode !== "interval" ? `
          <div class="btn-row" style="gap:5px">
            <button type="button" class="glass-btn sm" data-llm-slots="12:30, 18:30, 21:30">午晚日结 (12:30/18:30/21:30)</button>
            <button type="button" class="glass-btn sm" data-llm-slots="09:30, 13:30, 21:30">早中晚</button>
            <button type="button" class="glass-btn sm" data-llm-slots="21:30">仅 21:30</button>
          </div>
        ` : ""}
        <div class="btn-row">
          <button type="submit" class="glass-btn sm primary">保存配置</button>
          <button type="button" class="glass-btn sm" data-action="test-memory-llm">测试连通性</button>
          ${llmCfg.hasApiKey ? `<button type="button" class="glass-btn sm" data-action="clear-memory-llm-key">清除 Key</button>` : ""}
        </div>
      </form>
    ` : "";

    const centerConsolidationCard = `
      <div class="card">
        <div class="card-head">
          <span class="card-title">${isEndpoint ? "全端共享记忆 · 中心权威同步" : "中心大模型记忆整理 · 全端共享"}</span>
          <span class="tag ${llmTagCls}">${esc(llmTagText)}</span>
        </div>
        ${isEndpoint ? `
          <div class="proj-meta-badges">
            <span class="mini-pill" style="color:var(--accent)">自动同步已开启</span>
            <span class="mini-pill" style="color:var(--accent)">中心版本 #${cons.syncedCenterRevision || 0}</span>
            <span class="mini-pill">来源 ${esc(cons.syncedCenterDevice || net.endpoint?.name || "中心点")}</span>
            <span class="mini-pill">${net.syncMeta?.lastMemorySync?.time ? `已同步 ${fmtShortTime(net.syncMeta.lastMemorySync.time)}` : (cons.syncedCenterAt ? `整理于 ${fmtTime(cons.syncedCenterAt)}` : "等待中心同步")}</span>
          </div>
          <div class="muted-note">${esc(cons.lastSummary || "已自动开启 10s 中心新版本检测与 60s 定时双向同步：中心点完成整理后，本机将自动拉取并收敛为全端统一记忆。")}</div>
          <div class="btn-row">
            <button type="button" class="glass-btn sm primary" data-action="sync-memory-now">⟳ 立即同步中心记忆</button>
            <button type="button" class="glass-btn sm" data-action="read-consolidation-report">查看整理报告</button>
          </div>
        ` : `
          <div class="proj-meta-badges">
            <span class="mini-pill" style="color:var(--accent)">权威版 #${cons.revision || 0}</span>
            <span class="mini-pill" style="${(cons.pendingCount || 0) > 0 ? "color:var(--orange)" : ""}">待整理 ${cons.pendingCount || 0} 条</span>
            <span class="mini-pill">触发 ${esc(llmCfg.nextTriggerLabel || "—")}</span>
            <span class="mini-pill">${esc(llmCfg.configured ? `${llmCfg.model}` : "未配 API（规则兜底）")}</span>
          </div>
          ${cons.lastError ? `<div class="muted-note" style="color:var(--red)">上次告警：${esc(cons.lastError)}</div>` : ""}
          <div class="muted-note">${esc(cons.lastSummary || (llmCfg.configured ? `已配置 ${llmCfg.model}，将按 ${llmCfg.scheduleMode === "interval" ? `每 ${llmCfg.intervalHours} 小时` : (llmCfg.timeSlots || []).join(" / ")} 自动整理多端记忆并同步给所有接入点。` : "配置大模型 API 后，中心点将按时间段自动把全端记忆去重、消解冲突、提炼压缩后再同步给其他端。"))}</div>
          <div class="btn-row">
            <button type="button" class="glass-btn sm primary" data-action="consolidate-memory-now"${mem.phase === "consolidating" ? " disabled" : ""}>${mem.phase === "consolidating" ? "大模型整理中…" : "✦ 立即大模型整理"}</button>
            <button type="button" class="glass-btn sm" data-action="toggle-memory-llm-config">⚙ 模型与时间段</button>
            <button type="button" class="glass-btn sm" data-action="read-consolidation-report">整理报告</button>
          </div>
        `}
      </div>
      ${llmConfigForm}
    `;

    const retainForm = memoryRetainOpen ? `
      <form id="memoryRetainForm" class="card" style="background:rgba(var(--sunken-rgb),0.38)">
        <div class="card-head">
          <span class="card-title">写入原子记忆 (v3.0 · 支持 &lt;private&gt; 脱敏与 TTL)</span>
          <button type="button" class="glass-btn sm" data-action="toggle-retain-form">收起</button>
        </div>
        <input id="retainTitleInput" class="glass-input" placeholder="标题（可选，自动提取）" maxlength="90" />
        <textarea id="retainContentInput" class="glass-textarea" placeholder="记录偏好、架构决策、排错教训或变更（支持「从 A 改用 B」自动演进图谱）…" required></textarea>
        <div class="btn-grid-2">
          <select id="retainBankSelect" class="glass-select">
            <option value="">自动判别分区</option>
            <option value="world">world · 语义事实/决策</option>
            <option value="experience">experience · 过程教训/排错</option>
            <option value="opinion">opinion · 偏好/长期约束</option>
          </select>
          <input id="retainProjectInput" class="glass-input" placeholder="所属项目（可选）" maxlength="64" />
        </div>
        <div class="btn-grid-2">
          <input id="retainFactKeyInput" class="glass-input" placeholder="Fact Key（同 Key 自动 SUPERSEDE）" maxlength="64" />
          <input id="retainTtlInput" class="glass-input" type="number" min="1" max="3650" placeholder="TTL 天数（可选，如 30）" />
        </div>
        <div class="btn-row"><button type="submit" class="glass-btn sm primary">保存并更新图谱</button></div>
      </form>
    ` : "";

    let rightPanelHtml = "";
    if (memoryPreview) {
        rightPanelHtml = `
          <div class="card card-fill">
            <div class="card-head">
              <span class="card-title">${esc(memoryPreview.key)}</span>
              <div class="btn-row">
                ${memoryPreview.mdPath ? `<button type="button" class="glass-btn sm" data-action="open-memory-file" data-kind="${esc(memoryPreview.kind)}" data-key="${esc(memoryPreview.key)}">外部打开 ↗</button>` : ""}
                <button type="button" class="glass-btn sm primary" data-action="close-memory-preview">返回列表</button>
              </div>
            </div>
            <div class="mono-line">${memoryPreview.uri ? esc(memoryPreview.uri) : `原始 ${fmtBytes(memoryPreview.rawBytes)} → gzip ${fmtBytes(memoryPreview.compressedBytes)}`}</div>
            <pre class="reader-box">${esc(memoryPreview.content)}</pre>
          </div>
        `;
    } else {
        let tabBody = "";
        if (memoryCategory === "graph") {
            tabBody = `
              <div class="muted-note">双时态知识图谱（Cognee + Graphiti）：当前活跃实体 <strong>${cog.entities}</strong> 个、有效边 <strong>${cog.activeEdges}</strong> 条、历史演进边 <strong>${cog.historicalEdges}</strong> 条、已替代记忆 <strong>${cog.supersededItems}</strong> 条。</div>
              <div class="btn-row">
                <button type="button" class="glass-btn sm primary" data-read-memory="graph:graph">查看完整图谱与演进链</button>
                <button type="button" class="glass-btn sm" data-read-memory="items:">浏览原子记忆</button>
              </div>
            `;
        } else if (memoryCategory === "reflections") {
            tabBody = `
              <div class="muted-note">Hindsight 反思洞察：基于长期事实、用户偏好与演进链自动生成证据化观察报告（当前 ${cog.reflectionsCount || 0} 条）。</div>
              <div class="btn-row">
                <button type="button" class="glass-btn sm primary" data-action="reflect-memory">✦ 立即执行反思</button>
                <button type="button" class="glass-btn sm" data-read-memory="reflections:reflections">阅读反思报告</button>
              </div>
            `;
        } else {
            tabBody = list.length ? `<div class="item-list scroll-fill">${list.slice(0, 60).map(item => `
              <div class="item-row clickable" data-read-memory="${memoryCategory}:${esc(item.key)}">
                <div class="item-main">
                  <span class="item-dot" style="background:${memoryCategory === "daily" ? "var(--accent)" : memoryCategory === "weekly" ? "var(--blue)" : "var(--purple)"}"></span>
                  <div class="item-text">
                    <div class="item-title">${esc(item.label)}</div>
                    <div class="item-sub">${esc(item.sub)}</div>
                  </div>
                </div>
                <span class="card-meta">${fmtBytes(item.compressedBytes)}</span>
              </div>
            `).join("")}</div>` : `<div class="empty-state">暂无该周期压缩归档，点击顶部「同步并压缩」即可自动生成。</div>`;
        }

        rightPanelHtml = `
          <div class="card card-fill">
            <div class="card-head">
              <span class="card-title">分层归档 · 图谱 · 反思浏览器</span>
              <span class="tag ok">压缩率 ${mem.compressionRatio ?? 0}%</span>
            </div>
            <div class="seg-bar">
              <button type="button" class="seg-btn ${memoryCategory === "daily" ? "active" : ""}" data-mem-cat="daily">日(${c.daily})</button>
              <button type="button" class="seg-btn ${memoryCategory === "weekly" ? "active" : ""}" data-mem-cat="weekly">周(${c.weekly})</button>
              <button type="button" class="seg-btn ${memoryCategory === "monthly" ? "active" : ""}" data-mem-cat="monthly">月(${c.monthly})</button>
              <button type="button" class="seg-btn ${memoryCategory === "graph" ? "active" : ""}" data-mem-cat="graph">图谱</button>
              <button type="button" class="seg-btn ${memoryCategory === "reflections" ? "active" : ""}" data-mem-cat="reflections">反思</button>
            </div>
            ${tabBody}
          </div>
        `;
    }

    patchHtml(memoryStage, `
      <div class="stage-header">
        <div class="stage-title-group">
          <h2 class="stage-title">记忆与图谱</h2>
          <span class="stage-subtitle">v3.0 引擎 · RRF 三路混合召回 · Ebbinghaus 遗忘强化 · 4 层固化 · 双时态图谱</span>
        </div>
        <div class="stage-actions">
          <button type="button" class="glass-btn sm" data-action="open-memory-dir">归档目录 ↗</button>
          <button type="button" class="glass-btn sm" data-action="toggle-retain-form">+ 写入记忆</button>
          <button type="button" class="glass-btn sm primary" data-action="sync-memory-now">${mem.phase === "compressing" ? "同步中…" : "⟳ 同步并压缩"}</button>
        </div>
      </div>

      <div class="split-cols wide-right">
        <div class="col-stack">
          <div class="card">
            <div class="card-head">
              <span class="card-title">认知记忆引擎 v${esc(cog.engineVersion || "3.0.0")}</span>
              <span class="tag ${ms.installedCount === ms.totalCount ? "ok" : "warn"}">qlex-memory ${ms.installedCount}/${ms.totalCount}</span>
            </div>
            <div class="kpi-strip-3">
              <div class="kpi-chip"><span>活跃记忆</span><strong>${fmtNum(cog.activeItems || 0)}</strong></div>
              <div class="kpi-chip"><span>图谱实体/边</span><strong>${cog.entities || 0}/${cog.activeEdges || 0}</strong></div>
              <div class="kpi-chip"><span>日/周/月</span><strong>${c.daily}/${c.weekly}/${c.monthly}</strong></div>
            </div>
            <div class="proj-meta-badges" style="margin-top:2px">
              <span class="mini-pill" style="color:var(--accent)">热 ${temps.hot || 0}</span>
              <span class="mini-pill" style="color:var(--blue)">温 ${temps.warm || 0}</span>
              <span class="mini-pill">冷 ${temps.cold || 0}</span>
              <span class="mini-pill">休眠 ${temps.dormant || 0}</span>
              <span class="mini-pill" style="color:var(--purple)">语义 ${tiers.semantic || 0} · 教训 ${tiers.procedural || 0}</span>
              <span class="mini-pill" title="每 30 分钟自动增量归档 + 每日固定时间日结（本地时区）">日结 ${esc(state.memoryDailySettleTime || "关闭")} · 30m 周期</span>
            </div>
            <div class="btn-row">
              <button type="button" class="glass-btn sm primary" data-action="install-memory-skill">✦ 部署 ${ms.totalCount || 9} 工具技能</button>
              <button type="button" class="glass-btn sm" data-action="memory-profile">项目画像</button>
              <button type="button" class="glass-btn sm" data-action="reflect-memory">执行反思</button>
              <button type="button" class="glass-btn sm" data-action="memory-auto-forget">清理与诊断</button>
              <button type="button" class="glass-btn sm" data-action="choose-memory-dir">更改目录</button>
            </div>
            <div class="mono-line">${esc(mem.archiveDir || state.memoryArchiveDir || "")}</div>
          </div>

          ${centerConsolidationCard}

          ${retainForm}

          <div class="card card-fill">
            <div class="card-head">
              <span class="card-title">RRF 混合分层检索</span>
              <div class="seg-bar">
                ${["L0", "L1", "L2"].map(lv => `<button type="button" class="seg-btn ${memoryRecallLevel === lv ? "active" : ""}" data-mem-level="${lv}">${lv}</button>`).join("")}
              </div>
            </div>
            <div class="btn-row" style="justify-content:space-between;gap:6px">
              <div class="seg-bar">
                ${[["all", "全部"], ["memory", "记忆"], ["lesson", "教训"], ["observation", "洞察"]].map(([k, lbl]) => `<button type="button" class="seg-btn ${memoryRecallLayer === k ? "active" : ""}" data-mem-layer="${k}">${lbl}</button>`).join("")}
              </div>
              <div class="seg-bar">
                ${[[0, "全量"], [600, "600t"], [1200, "1200t"]].map(([b, lbl]) => `<button type="button" class="seg-btn ${memoryRecallBudget === b ? "active" : ""}" data-mem-budget="${b}">${lbl}</button>`).join("")}
              </div>
            </div>
            <form id="memoryRecallForm" class="search-bar-row">
              <input id="memoryRecallInput" class="glass-input" type="search" value="${esc(memoryRecallQuery)}" placeholder="BM25 + 2-hop 图谱 + 衰减强化混合检索…" />
              <button type="submit" class="glass-btn sm primary">检索</button>
            </form>
            ${memoryRecallResult ? `
              <div class="muted-note">命中 ${memoryRecallResult.results.length}/${memoryRecallResult.totalMatched} 条（${memoryRecallResult.level} · ~${memoryRecallResult.tokens_used || 0} tok${memoryRecallResult.excluded_by_budget ? ` · 预算裁剪 ${memoryRecallResult.excluded_by_budget} 条` : ""}）</div>
              <div class="item-list scroll-fill">
                ${memoryRecallResult.results.length ? memoryRecallResult.results.slice(0, 12).map(r => `
                  <div class="item-row clickable" data-browse-uri="${esc(r.uri)}">
                    <div class="item-text">
                      <div class="item-title">${esc(r.title)}</div>
                      <div class="item-sub">${esc(memoryRecallLevel === "L0" ? r.l0 : memoryRecallLevel === "L1" ? (r.l1 || r.l0) : (r.l2 || r.l1 || r.l0))}</div>
                    </div>
                    <span class="tag ${r.temperature === "hot" ? "ok" : ""}" title="RRF ${r.score} · 留存 ${Math.round((r.retentionScore || 0) * 100)}%">${esc(r.temperature || r.bank)}</span>
                  </div>
                `).join("") : `<div class="muted-note">未检索到相关记忆，试试其他关键词。</div>`}
              </div>
            ` : `<div class="muted-note">支持中英文同义词扩展、2-hop 图谱联查与 Token 预算控制，点击结果可在右侧完整阅读 L2 正文。</div>`}
          </div>
        </div>

        <div class="col-stack">
          ${rightPanelHtml}
        </div>
      </div>
    `);
}

/* ---- X Stage: eXtensions & Workspace (Projects Sync + 6-Tool Skills Sync) ---- */
function renderXStage() {
    const q = projectQuery.trim().toLowerCase();
    const remoteProjects = (state.remoteProjects || []).filter(rp => !q || rp.name.toLowerCase().includes(q));
    const managed = (state.projects || []).filter(p => !q || p.name.toLowerCase().includes(q) || p.directory.toLowerCase().includes(q));
    const managedSet = new Set((state.projects || []).map(p => p.directory));
    const discovered = (state.usage?.week?.projects || []).filter(p =>
        !managedSet.has(p.directory) && (!q || p.name.toLowerCase().includes(q) || p.directory.toLowerCase().includes(q))
    );

    const sk = state.skills || {};
    const namespaces = Object.values(sk.namespaces || {});
    const conflictDetails = sk.conflictDetails || [];
    const anomalies = sk.anomalies || [];
    const fixableAnomalies = anomalies.filter(a => a.fixable);
    const lastErrors = sk.lastErrors || [];
    const policy = state.skillSyncPolicy || sk.policy || { excludeHermesBundled: true, excludeHermesWebui: true, excludedSkills: [] };
    const oc = sk.originCounts || { total: sk.uniqueSkills || 0, syncable: sk.uniqueSkills || 0, user: 0, hermesBundled: 0, hermesWebui: 0, hermesHub: 0, excluded: 0, manualExcluded: 0, autoExcluded: 0, bundledManifestCount: 0, webuiManifestCount: 0 };
    const nsLabelMap = Object.fromEntries(namespaces.map(n => [n.id, n.label]));
    const sq = skillFilterQuery.trim().toLowerCase();
    const filteredCatalog = (sk.skillsCatalog || []).filter(item => {
        if (sq && !item.name.toLowerCase().includes(sq)) return false;
        if (skillFilterTab === "user") return item.origin === "user" || item.origin === "hermes-hub";
        if (skillFilterTab === "bundled") return item.origin === "hermes-bundled";
        if (skillFilterTab === "webui") return item.origin === "hermes-webui";
        if (skillFilterTab === "excluded") return item.excluded;
        return true;
    });
    const originBadgeClass = (o) => o === "hermes-bundled" ? "bundled" : o === "hermes-webui" ? "webui" : o === "hermes-hub" ? "hub" : "user";

    const net = state.pairing || { mode: "local", peers: [] };
    const projSync = net.syncMeta?.lastProjectsSync || net.syncMeta?.lastProjectSync || null;
    const autoMatches = state.projectAutoMatches || {};
    const onlinePeersCount = (net.peers || []).filter(p => p.online).length;
    const syncStripTone = projSync?.error ? "err"
        : net.mode === "endpoint" && !net.online ? "warn"
        : projSync?.time ? "ok" : "";
    const syncFileDetail = (projSync?.filesPushed || projSync?.filesPulled)
        ? ` · ↑${projSync.filesPushed || 0}/↓${projSync.filesPulled || 0} 文件`
        : projSync?.contextApplied ? ` · ${projSync.contextApplied} 份上下文` : "";
    const syncStripText = projSync?.error
        ? `⚠ 同步异常：${projSync.error}`
        : net.mode === "endpoint"
            ? (net.online
                ? `⇄ 已连中心 ${cleanHost(net.endpoint?.name || net.endpoint?.address || "中心")} · ${projSync?.time ? `已同步 ${fmtShortTime(projSync.time)}（共 ${projSync.totalShared ?? (state.projects?.length || 0)} 项${syncFileDetail}）` : "点击「⟳ 同步」立即对齐"}`
                : `⚠ 中心离线（${cleanHost(net.endpoint?.name || "")}），恢复连接后自动同步`)
            : net.mode === "center"
                ? `◉ 本机为中心点 · 托管 ${(state.projects || []).length + (state.remoteProjects || []).length} 个共享项目 · ${onlinePeersCount} 台接入点在线${projSync?.time ? ` · 最近同步 ${fmtShortTime(projSync.time)}${projSync.filesPulled ? `（收 ${projSync.filesPulled} 文件）` : ""}` : ""}`
                : `本机单机模式 · 前往「互联」连接中心点即可跨设备同步项目与工作区`;

    let projectsLeftHtml = "";
    if (projectDetail) {
        const proj = (selectedReport()?.projects || []).find(p => p.directory === projectDetail);
        const m = (state.projects || []).find(p => p.directory === projectDetail);
        projectsLeftHtml = `
          <div class="card card-fill">
            <div class="card-head">
              <span class="card-title">${esc(projectName(projectDetail))}</span>
              <button type="button" class="glass-btn sm" data-action="close-project-detail">返回项目列表</button>
            </div>
            <div class="mono-line">${esc(projectDetail)}</div>
            ${m && (m.gitBranch || m.gitRemote) ? `<div class="proj-meta-badges">
              ${m.gitBranch ? `<span class="mini-pill">分支 ${esc(m.gitBranch)}${m.gitCommit ? ` @ ${esc(m.gitCommit)}` : ""}</span>` : ""}
              ${m.contextFilesCount ? `<span class="mini-pill">AI 上下文 ${m.contextFilesCount} 份</span>` : ""}
              ${(m.syncedDevices || []).length ? `<span class="mini-pill">跨端设备 ${m.syncedDevices.map(d => cleanHost(d.name)).join(" ↔ ")}</span>` : ""}
            </div>` : ""}
            <div class="kpi-strip-3">
              <div class="kpi-chip"><span>${PERIODS[period]} Token</span><strong>${fmtCompact(proj?.tokens || 0)}</strong></div>
              <div class="kpi-chip"><span>会话数</span><strong>${fmtNum(proj?.sessions || 0)}</strong></div>
              <div class="kpi-chip"><span>状态</span><strong>${m ? "已登记" : "自动发现"}</strong></div>
            </div>
            <div class="btn-row">
              ${m ? `<button type="button" class="glass-btn sm" data-action="open-project" data-id="${esc(m.id)}">打开目录 ↗</button>`
                  : `<button type="button" class="glass-btn sm" data-action="open-discovered-project" data-directory="${esc(projectDetail)}">打开目录 ↗</button>
                     <button type="button" class="glass-btn sm primary" data-action="add-discovered-project" data-directory="${esc(projectDetail)}">+ 登记并同步</button>`}
            </div>
          </div>
        `;
    } else {
        projectsLeftHtml = `
          <div class="card card-fill">
            <div class="card-head">
              <span class="card-title">跨端同步项目与工作区</span>
              <div class="btn-row">
                <button type="button" class="glass-btn sm" data-action="sync-projects-now">⟳ 同步</button>
                <button type="button" class="glass-btn sm primary" data-action="add-project">+ 添加项目</button>
              </div>
            </div>
            <div class="sync-status-strip ${syncStripTone}">
              <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(syncStripText)}">${esc(syncStripText)}</span>
            </div>
            <div class="item-row" style="padding:8px 10px;background:rgba(var(--overlay-rgb),0.035);border-radius:10px;border:1px solid var(--line)">
              <div class="item-text" style="min-width:0">
                <div class="item-title" style="font-size:12px">同步项目保存目录</div>
                <div class="item-sub" style="font-size:11px" title="${esc(state.projectSyncDir || "")}">${esc(state.projectSyncDir || "~/Documents/QLEX-Projects")}</div>
              </div>
              <div class="btn-row" style="flex-wrap:nowrap">
                <button type="button" class="glass-btn sm ${state.autoSaveSyncedProjects !== false ? "primary" : ""}" data-action="toggle-auto-save-projects" title="开启后，对端共享的新项目会自动在该目录新建子文件夹并拉取全部文件">${state.autoSaveSyncedProjects !== false ? "✓ 自动落盘" : "手动绑定"}</button>
                <button type="button" class="glass-btn sm" data-action="choose-project-sync-dir">更改</button>
                <button type="button" class="glass-btn sm" data-action="open-project-sync-dir">打开 ↗</button>
              </div>
            </div>
            <input id="projectSearchInput" class="glass-input" type="search" value="${esc(projectQuery)}" placeholder="筛选项目名称或目录路径…" />

            <div class="scroll-fill" style="display:flex;flex-direction:column;gap:10px">
              ${remoteProjects.length ? `
                <div class="conflict-box" style="border-color:rgba(var(--accent-rgb),0.36);background:rgba(var(--accent-rgb),0.06)">
                  <div class="card-head"><span class="card-title" style="font-size:12px;color:var(--accent)">远端共享项目（待绑定 ${remoteProjects.length}）</span></div>
                  ${remoteProjects.map(rp => {
                      const match = autoMatches[rp.syncId];
                      return `
                    <div class="item-row">
                      <div class="item-text">
                        <div class="item-title">${esc(rp.name)}</div>
                        <div class="item-sub">来自 ${esc(cleanHost(rp.originDevice || "中心节点"))}${rp.gitBranch ? ` · ${esc(rp.gitBranch)}` : ""}${rp.fileCount ? ` · ${rp.fileCount} 文件 (${fmtBytes(rp.totalBytes || 0)})` : ""}${rp.contextFiles?.length ? ` · ${rp.contextFiles.length} 份上下文` : ""}</div>
                        ${match ? `<div class="item-sub" style="color:var(--accent)">⚡ 检测到本机同名目录（${esc(match.reason)}）：${esc(match.directory)}</div>` : ""}
                      </div>
                      <div class="btn-row" style="flex-wrap:nowrap">
                        ${match ? `<button type="button" class="glass-btn sm primary" data-auto-bind-sync="${esc(rp.syncId)}" data-auto-bind-dir="${esc(match.directory)}">⚡ 自动绑定</button>` : `<button type="button" class="glass-btn sm primary" data-auto-bind-sync="${esc(rp.syncId)}" data-auto-bind-dir="__default__">📥 保存到同步目录</button>`}
                        <button type="button" class="glass-btn sm" data-bind-remote-project="${esc(rp.syncId)}">选目录</button>
                      </div>
                    </div>
                  `;
                  }).join("")}
                </div>
              ` : ""}

              <div class="item-list">
                ${managed.length ? managed.map(p => editingProject === p.id ? `
                  <div class="item-row">
                    <form class="project-rename" data-id="${esc(p.id)}" style="display:flex;gap:6px;width:100%">
                      <input id="projectRenameInput" class="glass-input" value="${esc(p.name)}" maxlength="120" required />
                      <button type="submit" class="glass-btn sm primary">保存</button>
                      <button type="button" class="glass-btn sm" data-action="cancel-rename">取消</button>
                    </form>
                  </div>
                ` : `
                  <div class="item-row">
                    <div class="item-main clickable" data-project-detail="${esc(p.directory)}">
                      <span class="item-dot" style="background:var(--accent)"></span>
                      <div class="item-text">
                        <div class="item-title">${esc(p.name)}</div>
                        <div class="item-sub">${esc(p.directory)}</div>
                        <div class="proj-meta-badges">
                          ${p.gitBranch ? `<span class="mini-pill">${esc(p.gitBranch)}${p.gitCommit ? ` @ ${esc(p.gitCommit)}` : ""}</span>` : ""}
                          ${p.fileCount ? `<span class="mini-pill">${p.fileCount} 文件 · ${fmtBytes(p.totalBytes || 0)}</span>` : ""}
                          ${(p.syncedDevices || []).length > 1
                              ? `<span class="mini-pill" style="color:var(--success);border-color:rgba(var(--success-rgb),0.3)">⇄ 已同步 ${p.syncedDevices.length} 设备</span>`
                              : p.lastSyncedAt
                                  ? `<span class="mini-pill" style="color:var(--accent)">✓ 已推送中心</span>`
                                  : ""}
                          ${p.contextFilesCount ? `<span class="mini-pill">${p.contextFilesCount} 份上下文</span>` : ""}
                        </div>
                      </div>
                    </div>
                    <div class="btn-row" style="flex-wrap:nowrap">
                      <button type="button" class="glass-btn sm" data-action="open-project" data-id="${esc(p.id)}">打开</button>
                      <button type="button" class="glass-btn sm" data-action="rename-project" data-id="${esc(p.id)}">改名</button>
                      <button type="button" class="glass-btn sm danger" data-action="remove-project" data-id="${esc(p.id)}">移出</button>
                    </div>
                  </div>
                `).join("") : `<div class="muted-note">尚未登记本机项目。点击右上角「+ 添加项目」或从下方自动发现工作区一键登记。</div>`}
              </div>

              ${discovered.length ? `
                <div class="card-head" style="margin-top:2px"><span class="card-meta">近 7 天自动发现工作区 (${discovered.length})</span></div>
                <div class="item-list">
                  ${discovered.slice(0, 40).map(p => `
                    <div class="item-row">
                      <div class="item-main clickable" data-project-detail="${esc(p.directory)}">
                        <span class="item-dot" style="background:${sourceColor(p.sources?.[0])}"></span>
                        <div class="item-text">
                          <div class="item-title">${esc(p.name)}</div>
                          <div class="item-sub">${(p.sources || []).map(s => SOURCE_NAMES[s] || s).join(" · ")} · ${fmtCompact(p.tokens)} tok</div>
                        </div>
                      </div>
                      <button type="button" class="glass-btn sm btn-register" data-action="add-discovered-project" data-directory="${esc(p.directory)}">+ 登记</button>
                    </div>
                  `).join("")}
                </div>
              ` : ""}
            </div>
          </div>
        `;
    }

    patchHtml(workspaceStage, `
      <div class="stage-header">
        <div class="stage-title-group">
          <h2 class="stage-title">项目同步与技能</h2>
          <span class="stage-subtitle">跨设备工作区对齐 · 9 大 AI 工具本地 Skills 一致化、冲突仲裁与异常修复</span>
        </div>
        <div class="stage-actions">
          <button type="button" class="glass-btn sm" data-action="open-skill-backup-dir">冲突备份 ↗</button>
          ${fixableAnomalies.length ? `<button type="button" class="glass-btn sm danger" data-action="repair-skill-anomalies">修复异常 (${fixableAnomalies.length})</button>` : ""}
          <button type="button" class="glass-btn sm primary" data-action="sync-local-skills">⟳ 立即对齐 Skills</button>
        </div>
      </div>

      <div class="split-cols">
        <div class="col-stack">${projectsLeftHtml}</div>

        <div class="col-stack">
          <div class="card">
            <div class="card-head">
              <span class="card-title">9 大 AI 工具 Skills 同步矩阵</span>
              <span class="tag ${conflictDetails.length || anomalies.length ? "warn" : "ok"}">${sk.uniqueSkills ?? 0} 项 · ${conflictDetails.length ? `冲突 ${conflictDetails.length}` : anomalies.length ? `异常 ${anomalies.length}` : sk.missingLinks > 0 ? `待齐 ${sk.missingLinks}` : "已对齐"}</span>
            </div>
            <div class="skills-ns-grid grid-3">
              ${namespaces.map(ns => `
                <div class="skill-ns-chip ${ns.enabled ? "enabled" : ""} ${ns.exists ? "" : "missing"}" data-toggle-ns="${ns.id}" title="${esc(ns.path)}${ns.exists ? "" : "（目录尚未创建，同步时自动初始化）"}">
                  <span>${ns.enabled ? "✓ " : ""}${esc(ns.label)}</span>
                  <strong>${ns.exists ? ns.count : "—"}</strong>
                </div>
              `).join("")}
            </div>
            <div class="skill-policy-bar">
              <button type="button" class="skill-policy-chip ${policy.excludeHermesBundled ? "active" : ""}" data-policy-toggle="excludeHermesBundled" title="基于 ~/.hermes/skills/.bundled_manifest 与官方分类目录自动识别并跳过 Hermes 自带技能">
                <span>${policy.excludeHermesBundled ? "✓" : "○"} 跳过 Hermes 内置 (${oc.bundledManifestCount || oc.hermesBundled || 0})</span>
              </button>
              <button type="button" class="skill-policy-chip ${policy.excludeHermesWebui ? "active" : ""}" data-policy-toggle="excludeHermesWebui" title="基于 .webui-managed-skills.json 跳过强依赖 Hermes WebUI / Studio 的专属技能">
                <span>${policy.excludeHermesWebui ? "✓" : "○"} 跳过 WebUI 托管 (${oc.webuiManifestCount || oc.hermesWebui || 0})</span>
              </button>
            </div>
            <div class="muted-note">参与同步 <strong>${oc.syncable ?? sk.uniqueSkills ?? 0}</strong> 项 · 已过滤 <strong>${oc.excluded || 0}</strong> 项${oc.manualExcluded ? `（含手动排除 ${oc.manualExcluded}）` : ""}${sk.localTime ? ` · 最近对齐 ${fmtShortTime(sk.localTime)}` : ""}</div>
            <div class="btn-row">
              <button type="button" class="glass-btn sm primary" data-action="sync-local-skills">⟳ 同步本机 Skills</button>
              <button type="button" class="glass-btn sm" data-action="open-skill-dir" data-ns="agents">打开目录 ↗</button>
              <button type="button" class="glass-btn sm" data-action="install-memory-skill">部署 qlex-memory</button>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <span class="card-title">技能来源分类与按需过滤</span>
              <span class="tag ok">同步 ${oc.syncable ?? 0} / 共 ${oc.total ?? 0}</span>
            </div>
            <div class="seg-bar" style="flex-wrap:wrap">
              <button type="button" class="seg-btn ${skillFilterTab === "all" ? "active" : ""}" data-skill-tab="all">全部(${oc.total || 0})</button>
              <button type="button" class="seg-btn ${skillFilterTab === "user" ? "active" : ""}" data-skill-tab="user">用户(${(oc.user || 0) + (oc.hermesHub || 0)})</button>
              <button type="button" class="seg-btn ${skillFilterTab === "bundled" ? "active" : ""}" data-skill-tab="bundled">内置(${oc.hermesBundled || 0})</button>
              <button type="button" class="seg-btn ${skillFilterTab === "webui" ? "active" : ""}" data-skill-tab="webui">WebUI(${oc.hermesWebui || 0})</button>
              <button type="button" class="seg-btn ${skillFilterTab === "excluded" ? "active" : ""}" data-skill-tab="excluded">已排除(${oc.excluded || 0})</button>
            </div>
            <input id="skillFilterInput" class="glass-input" type="search" value="${esc(skillFilterQuery)}" placeholder="搜索技能名称，按需设置单技能排除同步…" />
            <div class="item-list" style="max-height:240px;overflow-y:auto">
              ${filteredCatalog.length ? filteredCatalog.slice(0, 120).map(item => `
                <div class="item-row skill-catalog-row ${item.excluded ? "is-excluded" : ""}" style="padding:7px 10px">
                  <div class="item-main">
                    <span class="item-dot" style="background:${item.hasConflict ? "var(--orange)" : item.excluded ? "var(--muted)" : "var(--success)"}"></span>
                    <div class="item-text">
                      <div class="item-title" style="font-size:12px">
                        ${esc(item.name)}
                        <span class="origin-badge ${originBadgeClass(item.origin)}">${esc(item.originLabel || "用户安装")}</span>
                        ${item.manualExcluded ? `<span class="origin-badge excluded">已排除</span>` : ""}
                      </div>
                      <div class="item-sub">${item.excluded ? esc(item.excludeReason) : `${(item.namespaces || []).map(ns => nsLabelMap[ns] || ns).join(" · ")}${item.missing?.length ? ` · 待补 ${item.missing.length} 目录` : " · 已对齐"}`}</div>
                    </div>
                  </div>
                  ${item.autoExcluded && !item.manualExcluded
                      ? `<span class="tag" title="由上方全局规则自动跳过">规则跳过</span>`
                      : item.manualExcluded
                          ? `<button type="button" class="glass-btn sm primary" data-toggle-exclude-skill="${esc(item.name)}:0">恢复同步</button>`
                          : `<button type="button" class="glass-btn sm" data-toggle-exclude-skill="${esc(item.name)}:1" title="将此技能加入排除名单，仅保留在当前工具目录中">排除同步</button>`}
                </div>
              `).join("") : `<div class="muted-note" style="padding:10px 4px">当前筛选条件下暂无技能。</div>`}
            </div>
          </div>

          ${conflictDetails.length ? `
            <div class="conflict-box">
              <div class="card-head">
                <span class="card-title" style="color:var(--orange)">技能冲突仲裁 (${conflictDetails.length})</span>
                <div class="btn-row" style="flex-wrap:nowrap">
                  <button type="button" class="glass-btn sm" data-resolve-strategy="codex" title="所有冲突全部以 Codex 版本为准覆盖并备份旧版">Codex 基准</button>
                  <button type="button" class="glass-btn sm primary" data-action="resolve-all-conflicts">⚡ 全部对齐</button>
                </div>
              </div>
              <div class="muted-note">处理策略：选择基准目录覆盖其余目录，旧版本自动归档至 <code>~/.qlex-skill-backups</code>；若某技能不适合跨工具同步，可直接点右侧「排除同步」。</div>
              <div class="item-list" style="max-height:280px;overflow-y:auto">
                ${conflictDetails.map(cf => `
                  <div class="conflict-item">
                    <div class="card-head">
                      <span class="item-title">${esc(cf.name)}<span class="origin-badge ${originBadgeClass(cf.origin)}">${esc(cf.originLabel || "用户安装")}</span></span>
                      <span class="card-meta">${esc(cf.diffHint || `${cf.variants.length} 个目录有差异`)}</span>
                    </div>
                    <div class="conflict-variants">
                      ${cf.variants.map(v => `
                        <button type="button" class="conflict-pick-btn ${v.recommended ? "recommended" : ""}" data-resolve-skill="${esc(cf.name)}:${esc(v.ns)}" title="哈希 ${esc(v.shortHash)} · 体积 ${fmtBytes(v.bytes)}">
                          <span>以 ${esc(v.label)} 为准${v.recommended ? " · 推荐" : ""}</span>
                          <small>${v.filesCount}文件 · ${fmtBytes(v.bytes)} · ${fmtTime(v.mtimeMs)}</small>
                        </button>
                      `).join("")}
                      <button type="button" class="conflict-pick-btn" data-toggle-exclude-skill="${esc(cf.name)}:1" title="将该技能排除在全量同步之外">排除同步</button>
                      <button type="button" class="conflict-pick-btn" data-action="open-skill-dir" data-ns="${esc(cf.recommendedNs || "agents")}" title="在 Finder 中人工比对">人工查看 ↗</button>
                    </div>
                  </div>
                `).join("")}
              </div>
            </div>
          ` : `
            <div class="card">
              <div class="card-head"><span class="card-title">技能冲突状态</span><span class="tag ok">✓ 0 冲突</span></div>
              <div class="muted-note">所有参与同步的通用技能内容哈希完全一致；已过滤的内置 / 专属技能不触发冲突。</div>
            </div>
          `}

          ${(anomalies.length || lastErrors.length) ? `
            <div class="anomaly-box">
              <div class="card-head">
                <span class="card-title" style="color:var(--red)">技能异常处理（${anomalies.length + lastErrors.length} 项）</span>
                ${fixableAnomalies.length ? `<button type="button" class="glass-btn sm primary" data-action="repair-skill-anomalies">⚡ 一键清理可修复项 (${fixableAnomalies.length})</button>` : ""}
              </div>
              <div class="item-list" style="max-height:180px;overflow-y:auto">
                ${anomalies.map(a => `
                  <div class="item-row" style="padding:7px 9px">
                    <div class="item-text">
                      <div class="item-title" style="font-size:12px">${esc(a.label)} / ${esc(a.name)} <span class="tag ${a.severity === "error" ? "err" : "warn"}" style="margin-left:4px">${esc(a.type === "broken-symlink" ? "损坏软链" : a.type === "stale-temp" ? "残留临时" : a.type === "missing-skill-md" ? "缺 SKILL.md" : a.type === "incomplete-files" ? "受限文件" : "超限/不可读")}</span></div>
                      <div class="item-sub">${esc(a.reason)} · 建议：${esc(a.suggestion)}</div>
                    </div>
                    <button type="button" class="glass-btn sm" data-action="open-skill-dir" data-ns="${esc(a.ns)}">定位 ↗</button>
                  </div>
                `).join("")}
                ${lastErrors.map(e => `<div class="muted-note" style="color:var(--red)">• ${esc(e)}</div>`).join("")}
              </div>
            </div>
          ` : ""}
        </div>
      </div>
    `);
}

/* ---- Status Stage: Live System, Sync, Collectors, Tailscale & Skills Telemetry ---- */
function statusRingSvg(pct, label, tone = "") {
    const r = 17;
    const circ = 2 * Math.PI * r;
    const clamped = Math.max(0, Math.min(100, pct));
    const offset = circ * (1 - clamped / 100);
    return `
      <div class="status-ring" title="${esc(label)} ${clamped}%">
        <svg viewBox="0 0 44 44">
          <circle class="track" cx="22" cy="22" r="${r}" />
          <circle class="fill ${tone}" cx="22" cy="22" r="${r}" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" />
        </svg>
        <span class="status-ring-label">${esc(label)}</span>
      </div>
    `;
}

function renderStatusStage() {
    const net = state.pairing || { mode: "local", peers: [] };
    const ts = state.tailscale || {};
    const sk = state.skills || {};
    const mem = state.memoryArchive || {};
    const cog = mem.cognitive || { activeItems: 0, entities: 0, activeEdges: 0 };
    const counts = mem.counts || { daily: 0, weekly: 0, monthly: 0 };
    const ms = state.memorySkill || { installedCount: 0, totalCount: 6 };
    const st = state.syncStatus || { phase: "idle", label: "待同步", time: 0 };
    const diag = state.usage?.diagnostics || {};
    const upd = state.updater || { phase: "idle", currentVersion: state.version };
    const health = computeHealth(state);
    const namespaces = Object.values(sk.namespaces || {});
    const syncMeta = net.syncMeta || {};

    const eqLit = Math.max(2, Math.round(health.score / 10));
    const eqBars = Array.from({ length: 10 }, (_, i) =>
        `<span class="status-eq-bar ${i < eqLit ? (health.phase === "ok" ? "on" : "warn") : ""}"></span>`
    ).join("");

    const agentPct = ms.totalCount ? Math.round(((ms.installedCount || 0) / ms.totalCount) * 100) : 100;
    const alignedPct = sk.conflicts > 0 ? Math.max(20, 100 - sk.conflicts * 15) : sk.missingLinks > 0 ? 80 : 100;
    const netPct = ts.online ? 100 : net.online ? 85 : 50;

    patchHtml(statusStage, `
      <div class="stage-header">
        <div class="stage-title-group">
          <h2 class="stage-title">运行状态</h2>
          <span class="stage-subtitle">综合健康评估 · 同步链路 · 8 大 Agent 采集器与 9 工具技能实时状态</span>
        </div>
        <div class="stage-actions">
          <button type="button" class="glass-btn sm" data-action="refresh-usage">⟳ 刷新采集</button>
          <button type="button" class="glass-btn sm" data-action="tailscale-scan">扫描穿透</button>
          <button type="button" class="glass-btn sm primary" data-action="sync-now">立即双向同步</button>
        </div>
      </div>

      <div class="status-kpi-grid">
        <div class="status-kpi-card">
          <div class="card-head">
            <span class="card-title">综合健康</span>
            <span class="tag ${health.phase === "ok" ? "ok" : "warn"}">${esc(health.label)}</span>
          </div>
          <div class="status-kpi-val">${health.score}<small>/ 100</small></div>
          <div class="status-eq-bars">${eqBars}</div>
          <div class="item-sub">${ROLES[net.mode]} · ${esc(cleanHost(state.deviceName))}</div>
        </div>

        <div class="status-kpi-card">
          <div class="card-head">
            <span class="card-title">双向同步</span>
            <span class="tag ${st.phase === "synced" ? "ok" : st.phase === "error" ? "err" : "warn"}">${fmtShortTime(st.time)}</span>
          </div>
          <div class="status-kpi-val">${esc(st.phase === "syncing" ? "同步中" : st.phase === "synced" ? "正常" : st.label)}</div>
          <div class="item-sub">记忆 ${fmtShortTime(syncMeta.lastMemorySync?.time)} · 项目 ${fmtShortTime(syncMeta.lastProjectsSync?.time)}</div>
        </div>

        <div class="status-kpi-card">
          <div class="card-head">
            <span class="card-title">内网穿透</span>
            <span class="tag ${ts.online ? "ok" : "warn"}">${ts.mode === "embedded" && ts.online ? "tsnet" : ts.online ? "已穿透" : "未连接"}</span>
          </div>
          <div class="status-kpi-val">${ts.online ? `${(ts.discoveredCenters || []).length}<small>台中心</small>` : "局域网"}</div>
          <div class="item-sub">${esc(ts.self?.ip || ts.self?.dnsName || "支持 Tailscale / 内嵌 tsnet")}</div>
        </div>

        <div class="status-kpi-card">
          <div class="card-head">
            <span class="card-title">能力覆盖</span>
            <span class="tag ${agentPct === 100 && alignedPct === 100 ? "ok" : "warn"}">${ms.installedCount}/${ms.totalCount} 工具</span>
          </div>
          <div class="status-rings-row">
            ${statusRingSvg(agentPct, "技能", agentPct === 100 ? "" : "warn")}
            ${statusRingSvg(alignedPct, "对齐", alignedPct === 100 ? "" : "warn")}
            ${statusRingSvg(netPct, "穿透", ts.online ? "" : "blue")}
          </div>
        </div>
      </div>

      <div class="split-cols">
        <div class="col-stack">
          <div class="card">
            <div class="card-head">
              <span class="card-title">核心服务与 8 大 Agent 采集器</span>
              <span class="tag ok">${esc(state.usage?.engine || "native")} 引擎</span>
            </div>
            <div class="item-list">
              <div class="item-row" style="padding:7px 10px">
                <div class="item-main">
                  <span class="item-dot" style="background:${net.online || net.mode === "local" ? "var(--success)" : "var(--orange)"}"></span>
                  <div class="item-text">
                    <div class="item-title" style="font-size:12px">同步中心 / 接入点通信服务</div>
                    <div class="item-sub">${ROLES[net.mode]} · 端口 ${net.port || 46271} · ${(net.peers || []).filter(p => p.online).length}/${(net.peers || []).length} 在线</div>
                  </div>
                </div>
                <span class="tag ${net.online || net.mode === "local" ? "ok" : "warn"}">${net.online || net.mode === "local" ? "正常" : "离线"}</span>
              </div>
              <div class="item-row" style="padding:7px 10px">
                <div class="item-main">
                  <span class="item-dot" style="background:var(--purple)"></span>
                  <div class="item-text">
                    <div class="item-title" style="font-size:12px">认知记忆压缩归档引擎</div>
                    <div class="item-sub">活跃 ${cog.activeItems || 0} 条 · 日${counts.daily}/周${counts.weekly}/月${counts.monthly} · 压缩率 ${mem.compressionRatio ?? 0}%</div>
                  </div>
                </div>
                <span class="tag ok">运行中</span>
              </div>
              ${Object.entries(SOURCE_NAMES).map(([k, label]) => {
                  const d = diag[k] || { status: "empty", filesScanned: 0, sessionsFound: 0 };
                  const cls = d.status === "ok" ? "ok" : d.status === "missing" ? "warn" : "";
                  const txt = d.status === "ok" ? "正常" : d.status === "missing" ? "未安装" : "无记录";
                  return `<div class="item-row" style="padding:6px 10px">
                    <div class="item-main">
                      <span class="item-dot" style="background:${sourceColor(k)}"></span>
                      <div class="item-text">
                        <div class="item-title" style="font-size:12px">${label}</div>
                        <div class="item-sub">${d.sessionsFound || 0} 会话 · ${d.filesScanned || 0} 日志文件</div>
                      </div>
                    </div>
                    <span class="tag ${cls}">${txt}</span>
                  </div>`;
              }).join("")}
            </div>
          </div>
        </div>

        <div class="col-stack">
          <div class="card">
            <div class="card-head">
              <span class="card-title">9 大工具 Skills 目录健康状态</span>
              <span class="tag ${sk.conflicts > 0 ? "warn" : "ok"}">${sk.conflicts > 0 ? `冲突 ${sk.conflicts}` : `${sk.uniqueSkills ?? 0} 项已对齐`}</span>
            </div>
            <div class="skills-ns-grid grid-3">
              ${namespaces.map(ns => `
                <div class="skill-ns-chip ${ns.enabled ? "enabled" : ""} ${ns.exists ? "" : "missing"}" data-rail="workspace" title="${esc(ns.path)}">
                  <span>${ns.enabled ? "✓ " : ""}${esc(ns.label)}</span>
                  <strong>${ns.exists ? ns.count : "—"}</strong>
                </div>
              `).join("")}
            </div>
            <div class="btn-row">
              <button type="button" class="glass-btn sm primary" data-action="sync-local-skills">⟳ 一键对齐</button>
              ${sk.conflicts > 0 ? `<button type="button" class="glass-btn sm" style="color:var(--orange)" data-action="resolve-all-conflicts">⚡ 全部解冲突</button>` : ""}
              <button type="button" class="glass-btn sm" data-action="install-memory-skill">部署 Agent 技能</button>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <span class="card-title">环境与版本推送状态</span>
              <span class="tag ok">v${esc(state.version)}</span>
            </div>
            <div class="kpi-strip-3">
              <div class="kpi-chip"><span>更新通道</span><strong>${(state.updateChannel || "beta") === "beta" ? "Beta" : "Stable"}</strong></div>
              <div class="kpi-chip"><span>系统平台</span><strong>${state.platform === "darwin" ? "macOS" : state.platform}</strong></div>
              <div class="kpi-chip"><span>已绑项目</span><strong>${(state.projects || []).length}</strong></div>
            </div>
            ${upd.phase === "downloading" || upd.phase === "verifying" ? `
              <div class="muted-note">${upd.phase === "verifying" ? "正在校验 SHA-256…" : `正在下载 v${esc(upd.latest?.version || "")} (${upd.progress || 0}%${upd.totalBytes ? ` · ${fmtBytes(upd.downloadedBytes)} / ${fmtBytes(upd.totalBytes)}` : ""})`}</div>
              <div class="update-progress-track"><div class="update-progress-fill" style="width:${upd.progress || 0}%"></div></div>
            ` : ""}
            <div class="btn-row">
              <button type="button" class="glass-btn sm" data-action="update-check"${["checking", "downloading", "verifying", "installing"].includes(upd.phase) ? " disabled" : ""}>${upd.phase === "checking" ? "检查中…" : "检查新版本"}</button>
              ${upd.phase === "available" ? `<button type="button" class="glass-btn sm primary" data-action="update-download">↓ 下载 ${esc(upd.latest?.version || "")}</button>` : ""}
              ${upd.phase === "ready" ? `<button type="button" class="glass-btn sm primary" data-action="update-install">⚡ 更新并重启</button>` : ""}
              <button type="button" class="glass-btn sm" data-action="open-memory-dir">记忆目录 ↗</button>
            </div>
          </div>
        </div>
      </div>
    `);
}

/* ---- Auxiliary Insights Stage (Usage, Quotas, Sessions, Trends) ---- */
function renderInsightsStage() {
    const report = selectedReport();
    const totalSessions = report ? Object.values(report.totals || {}).reduce((s, x) => s + (x.sessions || 0), 0) : 0;

    let bodyHtml = "";
    if (insightsTab === "usage") {
        const entries = Object.entries(SOURCE_NAMES).map(([k, label]) => ({
            key: k, label, stats: report?.totals?.[k] || { tokens: 0, sessions: 0, input: 0, output: 0, cacheRead: 0 },
        })).sort((a, b) => b.stats.tokens - a.stats.tokens);
        const maxT = Math.max(1, ...entries.map(e => e.stats.tokens));
        bodyHtml = `
          <div class="split-cols">
            <div class="card">
              <div class="card-head"><span class="card-title">5 大工具用量分布（${PERIODS[period]}）</span><span class="card-meta">总计 ${fmtNum(report?.total || 0)}</span></div>
              <div class="item-list">
                ${entries.map(({ key, label, stats }) => `
                  <div class="item-row" style="flex-direction:column;align-items:stretch;gap:4px">
                    <div style="display:flex;justify-content:space-between;align-items:center">
                      <span class="item-title"><span class="item-dot" style="display:inline-block;margin-right:7px;background:${sourceColor(key)}"></span>${label}</span>
                      <span class="item-title" style="font-variant-numeric:tabular-nums">${fmtNum(stats.tokens)} <small style="color:var(--muted)">(${stats.sessions} 会话)</small></span>
                    </div>
                    <div class="bar"><div class="bar-fill" style="width:${Math.round((stats.tokens / maxT) * 100)}%;background:${sourceColor(key)}"></div></div>
                  </div>
                `).join("")}
              </div>
            </div>
            <div class="card trend-canvas-box">
              <div class="card-head"><span class="card-title">每日活动趋势</span><button type="button" class="glass-btn sm" data-action="open-dashboard-trends">独立大屏 ↗</button></div>
              <canvas id="trendChart"></canvas>
            </div>
          </div>
        `;
    } else if (insightsTab === "limits") {
        const codex = state.usage?.quotas?.codex;
        bodyHtml = `
          <div class="card">
            <div class="card-head"><span class="card-title">Codex 订阅额度监控</span><span class="card-meta">${codex?.time ? `采样于 ${fmtTime(codex.time)}` : "暂无记录"}</span></div>
            ${codex?.windows?.length ? `<div class="tide-orbs-grid">${codex.windows.map(w => {
                const expired = w.resetsAt && w.resetsAt <= Date.now();
                const rem = expired ? 100 : Math.max(0, Math.min(100, Math.round(100 - w.used)));
                const cls = rem <= 15 ? "danger" : rem <= 35 ? "warn" : "";
                return `<div class="tide-card">
                  <div class="tide-orb ${cls}" style="--tide-pct:${rem}%">
                    <div class="tide-wave-wrap"></div>
                    <span class="tide-pct-label">${rem}%</span>
                  </div>
                  <strong>${w.minutes ? `${fmtNum(w.minutes)} 分钟窗口` : "当前周期"}</strong>
                  <span class="card-meta">${expired ? "窗口已重置" : w.resetsAt ? `重置 ${fmtTime(w.resetsAt)}` : "剩余额度"}</span>
                </div>`;
            }).join("")}</div>` : `<div class="empty-state">暂无本机订阅额度数据。使用 Codex 后将自动采集。</div>`}
          </div>
        `;
    } else {
        const sessions = (report?.sessions || []).filter(s => !sessionSource || s.source === sessionSource);
        bodyHtml = `
          <div class="card">
            <div class="card-head">
              <span class="card-title">历史会话记录（${sessions.length} 条）</span>
              <select id="sessionSourceFilter" class="glass-select" style="width:160px">
                <option value="">全部工具</option>
                ${Object.entries(SOURCE_NAMES).map(([k, l]) => `<option value="${k}" ${k === sessionSource ? "selected" : ""}>${l}</option>`).join("")}
              </select>
            </div>
            <div class="item-list" style="max-height:380px;overflow-y:auto">
              ${sessions.length ? sessions.slice(0, sessionLimit).map(s => `
                <div class="item-row">
                  <div class="item-main">
                    <span class="item-dot" style="background:${sourceColor(s.source)}"></span>
                    <div class="item-text">
                      <div class="item-title">${esc(s.workspace ? projectName(s.workspace) : "未归属工作区")}</div>
                      <div class="item-sub">${SOURCE_NAMES[s.source] || s.source} · ${fmtTime(s.lastActive)}</div>
                    </div>
                  </div>
                  <span class="card-meta">${fmtNum(s.tokens)} tok</span>
                </div>
              `).join("") : `<div class="empty-state">当前条件下暂无会话记录。</div>`}
            </div>
          </div>
        `;
    }

    patchHtml(insightsStage, `
      <div class="stage-header">
        <div class="stage-title-group">
          <h2 class="stage-title">辅助洞察</h2>
          <span class="stage-subtitle">${PERIODS[period]} · ${fmtNum(totalSessions)} 次会话 · Token 统计仅作辅助参考</span>
        </div>
        <div class="stage-actions">
          <div class="seg-bar">
            <button type="button" class="seg-btn ${insightsTab === "usage" ? "active" : ""}" data-insights-tab="usage">用量与趋势</button>
            <button type="button" class="seg-btn ${insightsTab === "limits" ? "active" : ""}" data-insights-tab="limits">订阅额度</button>
            <button type="button" class="seg-btn ${insightsTab === "sessions" ? "active" : ""}" data-insights-tab="sessions">历史会话</button>
          </div>
          <div class="seg-bar">
            <button type="button" class="seg-btn ${period === 1 ? "active" : ""}" data-period="1">今日</button>
            <button type="button" class="seg-btn ${period === 7 ? "active" : ""}" data-period="7">7天</button>
            <button type="button" class="seg-btn ${period === 30 ? "active" : ""}" data-period="30">30天</button>
          </div>
        </div>
      </div>
      ${bodyHtml}
    `);

    if (insightsTab === "usage") paintTrendCanvas();
}

function paintTrendCanvas() {
    const canvas = document.querySelector("#trendChart");
    if (!canvas) return;
    const report = selectedReport();
    const rows = period === 1
        ? (report ? [{ date: new Date().toISOString().slice(0, 10), tokens: report.total || 0 }] : [])
        : (report?.daily || []);
    const observed = new Map(rows.map(r => [r.date, r.tokens]));
    const end = new Date();
    const daysCount = Math.min(period, 30);
    const series = Array.from({ length: daysCount }, (_, idx) => {
        const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (daysCount - idx - 1));
        const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return { label, tokens: observed.get(label) || 0 };
    });
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const style = getComputedStyle(document.documentElement);
    const muted = style.getPropertyValue("--muted").trim() || "#98a4b6";
    const chartColor = style.getPropertyValue("--chart-color").trim() || "#73bdf5";
    const ceiling = Math.max(1, ...series.map(s => s.tokens));
    const left = 38, plot = w - left - 8, base = h - 22;
    const step = plot / series.length;
    ctx.font = "10px -apple-system, sans-serif";
    for (let t = 0; t <= 2; t++) {
        const y = base - t * (base - 10) / 2;
        ctx.fillStyle = muted;
        ctx.fillText(fmtCompact(Math.round(ceiling * t / 2)), 0, y + 3);
        ctx.fillStyle = "rgba(232,238,244,0.09)";
        ctx.fillRect(left, y, plot, 1);
    }
    const barW = Math.min(22, Math.max(3, step * 0.6));
    const every = Math.max(1, Math.ceil(series.length / 6));
    series.forEach((pt, i) => {
        const cx = left + step * (i + 0.5);
        const bh = (base - 10) * pt.tokens / ceiling;
        ctx.fillStyle = chartColor;
        ctx.beginPath();
        ctx.roundRect(cx - barW / 2, base - bh, barW, Math.max(bh, pt.tokens > 0 ? 2 : 0), [3, 3, 0, 0]);
        ctx.fill();
        if (i % every === 0 || i === series.length - 1) {
            ctx.fillStyle = muted;
            const txt = pt.label.slice(5);
            ctx.fillText(txt, cx - ctx.measureText(txt).width / 2, h - 5);
        }
    });
}

/* ---- Settings Stage (2-Column Spacious Settings) ---- */
function renderSettingsStage() {
    const a = state.appearance || {};
    const presetItems = Object.values(window.QlexTheme?.PRESETS || {});
    const isGlass = a.macBackdrop === "liquid-glass" || a.macBackdrop === "liquid-glass-clear";
    const tintVal = a.macBackdrop === "liquid-glass-clear" ? (a.macClearGlassTint ?? 35) : (a.macGlassTint ?? 0);
    const diag = state.usage?.diagnostics || {};
    const upd = state.updater || { phase: "idle", currentVersion: state.version };

    patchHtml(settingsStage, `
      <div class="stage-header">
        <div class="stage-title-group">
          <h2 class="stage-title">工作台设置</h2>
          <span class="stage-subtitle">外观材质 · 侧边吸附 · 日志采集诊断 · Beta / Stable 自动更新通道</span>
        </div>
      </div>

      <div class="split-cols">
        <div class="col-stack">
          <div class="card">
            <div class="card-head"><span class="card-title">外观与毛玻璃材质</span><span class="card-meta">主窗口与菜单栏同步生效</span></div>
            <div class="theme-swatches">
              ${presetItems.map(p => `
                <button type="button" class="theme-swatch ${a.themePreset === p.id ? "active" : ""}" data-theme-preset="${p.id}">
                  <span class="theme-swatch-dot" style="background:${p.bg};box-shadow:inset 0 0 0 2px ${p.accent}"></span>
                  <span>${p.name}</span>
                </button>
              `).join("")}
            </div>
            ${state.platform === "darwin" ? `
              <div class="settings-row">
                <span class="settings-label">系统毛玻璃材质</span>
                <input id="systemGlassInput" class="settings-switch" type="checkbox" ${a.systemGlass !== false ? "checked" : ""} />
              </div>
              <div class="settings-row">
                <span class="settings-label">macOS 背景材质</span>
                <select id="macBackdropSelect" class="glass-select" style="width:188px" ${a.systemGlass === false ? "disabled" : ""}>
                  <option value="vibrancy" ${a.macBackdrop === "vibrancy" ? "selected" : ""}>经典毛玻璃 (HUD)</option>
                  ${state.liquidGlassSupported ? `
                    <option value="liquid-glass" ${a.macBackdrop === "liquid-glass" ? "selected" : ""}>液态玻璃 (Liquid Glass)</option>
                    <option value="liquid-glass-clear" ${a.macBackdrop === "liquid-glass-clear" ? "selected" : ""}>清透液态玻璃 (Clear)</option>
                  ` : ""}
                </select>
              </div>
              ${isGlass && a.systemGlass !== false ? `
                <div class="settings-row"><span class="settings-label">液态玻璃染色深度</span><span class="card-meta" id="tintValueLabel">${tintVal}%</span></div>
                <input id="glassTintRange" class="glass-range" type="range" min="0" max="85" value="${tintVal}" />
              ` : `
                <div class="settings-row"><span class="settings-label">毛玻璃不透明度</span><span class="card-meta" id="opacityValueLabel">${a.glassOpacity ?? 68}%</span></div>
                <input id="glassOpacityRange" class="glass-range" type="range" min="20" max="100" value="${a.glassOpacity ?? 68}" />
              `}
            ` : `
              <div class="muted-note">Windows 已启用原生高清渲染模式（支持 ClearType 字体抗锯齿、原生圆角窗口与托盘面板自适应定位）。</div>
            `}
          </div>

          <div class="card">
            <div class="card-head"><span class="card-title">窗口、侧边吸附与自动化</span></div>
            <div class="settings-row">
              <span class="settings-label">侧边吸附位置</span>
              <select id="edgeDockSelect" class="glass-select" style="width:168px">
                <option value="off" ${!state.edgeDock || state.edgeDock === "off" ? "selected" : ""}>关闭</option>
                <option value="left" ${state.edgeDock === "left" ? "selected" : ""}>屏幕左侧</option>
                <option value="right" ${state.edgeDock === "right" ? "selected" : ""}>屏幕右侧</option>
              </select>
            </div>
            <div class="settings-row">
              <span class="settings-label">侧边吸附弹出方式</span>
              <select id="edgeDockModeSelect" class="glass-select" style="width:168px">
                <option value="autoHide" ${state.edgeDockMode !== "always" ? "selected" : ""}>鼠标悬浮弹出</option>
                <option value="always" ${state.edgeDockMode === "always" ? "selected" : ""}>始终停靠显示</option>
              </select>
            </div>
            <div class="settings-row"><span class="settings-label">自动同步本机 Skills</span><input id="skillSyncInput" class="settings-switch" type="checkbox" ${state.skillSyncEnabled ? "checked" : ""} /></div>
            <div class="settings-row"><span class="settings-label">每日/周/月记忆自动压缩</span><input id="memoryAutoInput" class="settings-switch" type="checkbox" ${state.memoryAutoCompress !== false ? "checked" : ""} /></div>
            <div class="settings-row"><span class="settings-label">窗口置顶显示</span><input id="alwaysOnTopInput" class="settings-switch" type="checkbox" ${a.alwaysOnTop ? "checked" : ""} /></div>
            <div class="settings-row"><span class="settings-label">关闭窗口后菜单栏后台常驻</span><input id="keepRunningInput" class="settings-switch" type="checkbox" ${state.keepRunning && state.trayAvailable ? "checked" : ""} ${state.trayAvailable ? "" : "disabled"} /></div>
          </div>
        </div>

        <div class="col-stack">
          <div class="card">
            <div class="card-head"><span class="card-title">版本下载与更新推送通道</span><span class="tag ok">v${esc(upd.currentVersion || state.version)}</span></div>
            <div class="settings-row">
              <span class="settings-label">推送通道</span>
              <select id="updateChannelSelect" class="glass-select" style="width:168px">
                <option value="beta" ${(state.updateChannel || "beta") === "beta" ? "selected" : ""}>Beta 尝鲜版</option>
                <option value="stable" ${state.updateChannel === "stable" ? "selected" : ""}>Stable 正式版</option>
              </select>
            </div>
            <div class="settings-row"><span class="settings-label">启动与定时自动检查更新</span><input id="autoUpdatesInput" class="settings-switch" type="checkbox" ${state.autoCheckUpdates !== false ? "checked" : ""} /></div>
            ${upd.phase === "downloading" || upd.phase === "verifying" ? `
              <div class="muted-note">${upd.phase === "verifying" ? "正在校验 SHA-256…" : `正在下载 ${esc(upd.latest?.assetName || "")} (${upd.progress || 0}%${upd.totalBytes ? ` · ${fmtBytes(upd.downloadedBytes)} / ${fmtBytes(upd.totalBytes)}` : ""}${upd.speedBytesPerSec ? ` · ${fmtBytes(upd.speedBytesPerSec)}/s` : ""})`}</div>
              <div class="update-progress-track"><div class="update-progress-fill" style="width:${upd.progress || 0}%"></div></div>
            ` : upd.phase === "installing" ? `
              <div class="muted-note" style="color:var(--blue)">正在安装 v${esc(upd.latest?.version || "")}，完成后将自动重启应用…</div>
              <div class="update-progress-track"><div class="update-progress-fill" style="width:100%"></div></div>
            ` : upd.phase === "available" && upd.latest ? `
              <div class="muted-note" style="color:var(--accent)">发现新版本 <strong>${esc(upd.latest.version)}</strong>（支持 SHA-256 强制校验）</div>
            ` : upd.phase === "ready" ? `
              <div class="muted-note" style="color:var(--success)">✓ 安装包已校验就绪，点击下方按钮更新并自动重启应用。</div>
            ` : upd.phase === "error" ? `
              <div class="muted-note" style="color:var(--red)">${esc(upd.error || "检查更新失败")}</div>
            ` : `<div class="muted-note">当前已是最新${(state.updateChannel || "beta") === "beta" ? " Beta " : " "}版本（更新源：haoyu-qi/qlex）。</div>`}
            <div class="btn-row">
              <button type="button" class="glass-btn sm" data-action="update-check"${["checking", "downloading", "verifying", "installing"].includes(upd.phase) ? " disabled" : ""}>${upd.phase === "checking" ? "检查中…" : "检查更新"}</button>
              ${upd.phase === "available" ? `<button type="button" class="glass-btn sm primary" data-action="update-download">↓ 下载更新</button>` : ""}
              ${upd.phase === "ready" ? `<button type="button" class="glass-btn sm primary" data-action="update-install">⚡ 更新并重启</button>` : ""}
              <button type="button" class="glass-btn sm" data-action="update-open-release">发布页 ↗</button>
            </div>
          </div>

          <div class="card">
            <div class="card-head">
              <span class="card-title">本地 8 大 Agent 日志采集诊断</span>
              <button type="button" class="glass-btn sm" data-action="refresh-usage">⟳ 重新采集</button>
            </div>
            <div class="item-list">
              ${Object.entries(SOURCE_NAMES).map(([k, label]) => {
                  const d = diag[k] || { status: "empty", filesScanned: 0, sessionsFound: 0 };
                  const cls = d.status === "ok" ? "ok" : d.status === "missing" ? "warn" : "";
                  const txt = d.status === "ok" ? "正常" : d.status === "missing" ? "未安装" : "无记录";
                  return `<div class="item-row" style="padding:7px 10px">
                    <div class="item-text"><div class="item-title" style="font-size:12px">${label}</div><div class="item-sub">${d.sessionsFound || 0} 会话 · ${d.filesScanned || 0} 文件</div></div>
                    <span class="tag ${cls}">${txt}</span>
                  </div>`;
              }).join("")}
            </div>
          </div>
        </div>
      </div>
    `);
}

function render() {
    if (!state) return;
    const appFp = JSON.stringify({ a: state.appearance || {}, p: state.platform || "" });
    if (appFp !== lastAppearanceFp) {
        lastAppearanceFp = appFp;
        window.QlexTheme?.applyAppearance(state.appearance, document.documentElement, document.body, state.platform);
    }
    const matFp = JSON.stringify(state.nativeMaterial || {});
    if (state.nativeMaterial && matFp !== lastMaterialFp) {
        lastMaterialFp = matFp;
        window.QlexTheme?.applyNativeMaterial(state.nativeMaterial);
    }

    updateTopbarAndRail();

    const stages = [onboardingPanel, overviewStage, linkStage, memoryStage, workspaceStage, statusStage, insightsStage, settingsStage];
    if (!state.configured) {
        for (const s of stages) setVisible(s, s === onboardingPanel);
        renderOnboarding();
        return;
    }

    const activeMap = {
        overview: overviewStage,
        link: linkStage,
        memory: memoryStage,
        workspace: workspaceStage,
        status: statusStage,
        insights: insightsStage,
        settings: settingsStage,
    };
    const currentStage = activeMap[activeSection] || overviewStage;
    for (const s of stages) setVisible(s, s === currentStage);

    if (activeSection === "overview") renderQStage();
    else if (activeSection === "link") renderLStage();
    else if (activeSection === "memory") renderEStage();
    else if (activeSection === "workspace") renderXStage();
    else if (activeSection === "status") renderStatusStage();
    else if (activeSection === "insights") renderInsightsStage();
    else if (activeSection === "settings") renderSettingsStage();
}

async function runAction(btn, fn, { goToSection = null, success = "" } = {}) {
    if (busy) return;
    busy = true;
    if (btn) btn.disabled = true;
    try {
        const next = await fn();
        if (next && next.version) state = next;
        else if (next?.state) state = next.state;
        if (goToSection) activeSection = goToSection;
        if (state?.pairing?.mode !== "local") joining = false;
        render();
        if (success) notify(success);
    } catch (err) {
        notify(String(err?.message || err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ""));
    } finally {
        if (btn) btn.disabled = false;
        busy = false;
    }
}

closeButton.addEventListener("click", () => void window.qlex.closeWindow());
minButton.addEventListener("click", () => void window.qlex.minimizeWindow());
pinButton.addEventListener("click", () => void runAction(pinButton, () => window.qlex.togglePinWindow()));
rolePill.addEventListener("click", () => { activeSection = "link"; render(); });
syncStatusBtn.addEventListener("click", () => void runAction(syncStatusBtn, () => window.qlex.syncNow(), { success: "双向同步与归档完成" }));
updatePillBtn.addEventListener("click", () => {
    const ph = state?.updater?.phase;
    if (ph === "ready") void runAction(updatePillBtn, () => window.qlex.updateInstall());
    else { activeSection = "settings"; render(); }
});

document.addEventListener("click", (event) => {
    const target = event.target;

    const actionBtn = target.closest("[data-action]");
    if (actionBtn && state) {
        event.stopPropagation();
        const act = actionBtn.dataset.action;
        if (act === "continue") {
            const mode = document.querySelector('input[name="mode"]:checked')?.value || "local";
            if (mode === "center") void runAction(actionBtn, () => window.qlex.enableCenter(), { goToSection: "link" });
            else if (mode === "endpoint") {
                const code = document.querySelector("#invite")?.value || "";
                void runAction(actionBtn, () => window.qlex.joinCenter(code), { goToSection: "link" });
            } else void runAction(actionBtn, () => window.qlex.configureLocal(), { goToSection: "overview" });
        } else if (act === "sync-now") {
            void runAction(actionBtn, () => window.qlex.syncNow(), { success: "双向同步与归档完成" });
        } else if (act === "sync-local-skills") {
            void runAction(actionBtn, () => window.qlex.syncLocalSkills(), { success: "本机 Skills 已对齐" });
        } else if (act === "resolve-all-conflicts") {
            void runAction(actionBtn, async () => {
                const res = await window.qlex.resolveAllSkillConflicts("latest");
                notify(`已解决 ${res.result?.resolvedCount || 0} 项冲突，旧版已备份`);
                return res.state;
            });
        } else if (act === "repair-skill-anomalies") {
            void runAction(actionBtn, async () => {
                const res = await window.qlex.repairSkillAnomalies();
                notify(`已清理修复 ${res.result?.cleaned || 0} 项技能目录异常`);
                return res.state;
            });
        } else if (act === "quick-write-memory") {
            activeSection = "memory";
            memoryRetainOpen = true;
            render();
            document.querySelector("#retainContentInput")?.focus();
        } else if (act === "open-skill-backup-dir") void window.qlex.openSkillBackupDir();
        else if (act === "open-skill-dir") void window.qlex.openSkillDir(actionBtn.dataset.ns || "agents");
        else if (act === "sync-memory-now") {
            void runAction(actionBtn, async () => {
                const res = await window.qlex.syncMemoryNow();
                notify(res.remote ? `记忆已与中心双向同步 (+${res.remote.pulledAdded || 0} 拉取 / +${res.remote.pushedAdded || 0} 推送)` : "记忆已压缩归档并更新图谱");
                return res.state;
            });
        } else if (act === "sync-projects-now") {
            void runAction(actionBtn, async () => {
                const res = await window.qlex.syncProjectsNow();
                const r = res.remote;
                if (r?.role === "endpoint") {
                    const parts = [`共 ${r.totalShared || 0} 个共享项目`];
                    if (r.added) parts.push(`新增 ${r.added}`);
                    if (r.updated) parts.push(`更新 ${r.updated}`);
                    if (r.removed) parts.push(`移出 ${r.removed}`);
                    if (r.filesPushed) parts.push(`推送 ${r.filesPushed} 文件`);
                    if (r.filesPulled) parts.push(`拉取 ${r.filesPulled} 文件`);
                    if (r.contextApplied) parts.push(`同步 ${r.contextApplied} 份上下文`);
                    notify(`跨端项目同步完成：${parts.join(" · ")}`);
                } else if (r?.role === "center") {
                    notify(`中心已刷新并托管 ${r.totalShared || 0} 个共享项目（${r.onlinePeers || 0} 台接入点在线）`);
                } else {
                    notify(`已刷新本机 ${r?.totalShared || 0} 个工作区元数据（连接中心后即可跨端同步）`);
                }
                return res.state;
            });
        } else if (act === "reflect-memory") {
            void runAction(actionBtn, async () => {
                const res = await window.qlex.memoryReflect({});
                notify(`Hindsight 反思完成：更新 ${res.result?.generated || 0} 条洞察`);
                return res.state;
            });
        } else if (act === "install-memory-skill") {
            void runAction(actionBtn, async () => {
                const res = await window.qlex.installMemorySkill();
                const st = res.result?.status;
                notify(`已将 qlex-memory 部署到 ${st?.installedCount || 0}/${st?.totalCount || 6} 个工具目录`);
                return res.state;
            });
        } else if (act === "memory-profile") {
            void runAction(actionBtn, async () => {
                const prof = await window.qlex.memoryProfile({ tokenBudget: 1200 });
                memoryPreview = { kind: "profile", key: `上下文画像 (~${prof.tokens_used} tok)`, uri: "qlex://profile", content: prof.text || "(暂无活跃记忆)" };
                renderEStage();
                return null;
            });
        } else if (act === "memory-auto-forget") {
            void runAction(actionBtn, async () => {
                const res = await window.qlex.memoryAutoForget({ dryRun: false });
                const diag = await window.qlex.memoryDiagnose();
                const cleaned = res.result?.cleanedCount || 0;
                const conflicts = res.result?.contradictions?.length || 0;
                const lines = [
                    `# QLEX 记忆健康诊断 (v${diag.engineVersion}) · 健康分 ${diag.healthScore}/100`,
                    "",
                    `- 本次自动清理：TTL 过期 ${res.result?.ttlExpired?.length || 0} 条 · 休眠工作记忆 ${res.result?.dormantEvicted?.length || 0} 条`,
                    `- 潜在冲突检测：${conflicts} 组`,
                    `- 温度分布：热 ${diag.cognitive?.temperatures?.hot || 0} · 温 ${diag.cognitive?.temperatures?.warm || 0} · 冷 ${diag.cognitive?.temperatures?.cold || 0} · 休眠 ${diag.cognitive?.temperatures?.dormant || 0}`,
                    `- 4 层固化：Working ${diag.cognitive?.tiers?.working || 0} · Episodic ${diag.cognitive?.tiers?.episodic || 0} · Semantic ${diag.cognitive?.tiers?.semantic || 0} · Procedural ${diag.cognitive?.tiers?.procedural || 0}`,
                    "",
                    "## 诊断建议",
                    ...(diag.recommendations || []).map(x => `- ${x}`),
                ];
                if (diag.contradictions?.length) {
                    lines.push("", "## 潜在冲突候选");
                    for (const c of diag.contradictions) {
                        lines.push(`- (${c.reason}, 相似度 ${c.similarity}) 「${c.memoryA.title}」 ↔ 「${c.memoryB.title}」`);
                    }
                }
                memoryPreview = { kind: "diagnose", key: `健康诊断 · ${diag.healthScore}分`, uri: "qlex://diagnose", content: lines.join("\n") };
                notify(`记忆清理与诊断完成：清理 ${cleaned} 条，发现 ${conflicts} 组潜在冲突`);
                return res.state;
            });
        } else if (act === "toggle-retain-form") {
            memoryRetainOpen = !memoryRetainOpen;
            renderEStage();
            if (memoryRetainOpen) document.querySelector("#retainContentInput")?.focus();
        } else if (act === "toggle-memory-llm-config") {
            memoryLlmConfigOpen = !memoryLlmConfigOpen;
            renderEStage();
        } else if (act === "consolidate-memory-now") {
            void runAction(actionBtn, async () => {
                const res = await window.qlex.consolidateMemoryNow({ force: true, triggerReason: "manual" });
                const r = res?.result;
                if (r?.skipped) {
                    notify("当前没有待整理的新增记忆");
                } else {
                    const modeStr = r?.mode === "llm" ? `大模型(${r.model})` : r?.mode === "fallback-rules" ? "规则降级" : "规则引擎";
                    const st = r?.stats || {};
                    notify(`中心整理完成 #${r?.revision || 0} [${modeStr}]：合并 ${st.mergedGroups || 0} 组 · 替代 ${st.supersededCount || 0} · 淘汰 ${st.prunedCount || 0}`);
                }
                return res?.state;
            });
        } else if (act === "read-consolidation-report") {
            void window.qlex.readConsolidationReport().then(entry => {
                memoryPreview = entry;
                renderEStage();
            }).catch(() => notify("读取中心整理报告失败"));
        } else if (act === "test-memory-llm") {
            const draft = collectMemoryLlmFormValues();
            void runAction(actionBtn, async () => {
                const res = await window.qlex.testMemoryLlm(draft);
                notify(`模型连通成功：${res.model} (${res.latencyMs}ms)`);
                return state;
            });
        } else if (act === "clear-memory-llm-key") {
            void runAction(actionBtn, () => window.qlex.setMemoryLlmConfig({ clearApiKey: true }), { success: "已清除保存的 API Key" });
        } else if (act === "open-memory-dir") void window.qlex.openMemoryDir();
        else if (act === "choose-memory-dir") void runAction(actionBtn, () => window.qlex.chooseMemoryDir(), { success: "记忆归档目录已更新" });
        else if (act === "open-memory-file") void window.qlex.openMemoryFile(actionBtn.dataset.kind, actionBtn.dataset.key);
        else if (act === "close-memory-preview") { memoryPreview = null; renderEStage(); }
        else if (act === "close-project-detail") { projectDetail = ""; renderXStage(); }
        else if (act === "refresh-usage") void runAction(actionBtn, () => window.qlex.refreshUsage(), { success: "5 大工具日志已重新采集" });
        else if (act === "tailscale-scan") void runAction(actionBtn, () => window.qlex.tailscaleScan(), { success: "Tailscale 与局域网扫描完成" });
        else if (act === "tailscale-start-embedded") void runAction(actionBtn, () => window.qlex.tailscaleStartEmbedded({}), { success: "已启动内嵌 Tailscale tsnet SDK" });
        else if (act === "tailscale-stop-embedded") void runAction(actionBtn, () => window.qlex.tailscaleStopEmbedded(), { success: "已停止内嵌 tsnet SDK" });
        else if (act === "tailscale-open-auth") void window.qlex.tailscaleOpenAuth();
        else if (act === "update-check") void runAction(actionBtn, () => window.qlex.updateCheck(true), { success: "更新检查完成" });
        else if (act === "update-download") void runAction(actionBtn, () => window.qlex.updateDownload(), { success: "更新下载并校验完成，点击「更新并重启」生效" });
        else if (act === "update-install") void runAction(actionBtn, () => window.qlex.updateInstall());
        else if (act === "update-open-release") void window.qlex.updateOpenRelease();
        else if (act === "open-dashboard-trends") void window.qlex.openDashboard("trends");
        else if (act === "add-project") void runAction(actionBtn, () => window.qlex.chooseProject(), { success: "项目已登记并同步至对端" });
        else if (act === "open-project-sync-dir") void window.qlex.openProjectSyncDir();
        else if (act === "choose-project-sync-dir") void runAction(actionBtn, () => window.qlex.chooseProjectSyncDir(), { success: "同步项目保存目录已更新" });
        else if (act === "toggle-auto-save-projects") {
            const nextVal = state?.autoSaveSyncedProjects === false;
            void runAction(actionBtn, () => window.qlex.setAutoSaveProjects(nextVal), {
                success: nextVal ? "已开启自动落盘：远端新项目将自动保存到同步目录" : "已切换为手动选择目录绑定",
            });
        }
        else if (act === "add-discovered-project") void runAction(actionBtn, () => window.qlex.addDiscoveredProject(actionBtn.dataset.directory), { success: "已登记项目并触发跨端同步" });
        else if (act === "open-discovered-project") void runAction(actionBtn, () => window.qlex.openDiscoveredProject(actionBtn.dataset.directory));
        else if (act === "open-project") void runAction(actionBtn, () => window.qlex.openProject(actionBtn.dataset.id));
        else if (act === "rename-project") { editingProject = actionBtn.dataset.id; renderXStage(); document.querySelector("#projectRenameInput")?.focus(); }
        else if (act === "cancel-rename") { editingProject = ""; renderXStage(); }
        else if (act === "remove-project") void runAction(actionBtn, () => window.qlex.removeProject(actionBtn.dataset.id));
        else if (act === "enable-center") void runAction(actionBtn, () => window.qlex.enableCenter());
        else if (act === "show-join") { joining = true; renderLStage(); document.querySelector("#invite")?.focus(); }
        else if (act === "cancel-join") { joining = false; renderLStage(); }
        else if (act === "submit-invite") void runAction(actionBtn, () => window.qlex.joinCenter(document.querySelector("#invite")?.value || ""));
        else if (act === "use-local") void runAction(actionBtn, () => window.qlex.useLocal());
        else if (act === "invite") {
            invitationAddress = document.querySelector("#centerAddress")?.value || invitationAddress || state?.pairing?.activeInvite?.host || state?.pairing?.addresses?.[0] || "";
            void runAction(actionBtn, () => window.qlex.createInvite(invitationAddress), { success: "已刷新配对邀请并复制到剪贴板" });
        } else if (act === "copy-invite") {
            void runAction(actionBtn, () => window.qlex.copyInvite(), { success: "邀请码已复制到剪贴板" });
        } else if (act === "approve") void runAction(actionBtn, () => window.qlex.approveDevice(actionBtn.dataset.id));
        else if (act === "remove") void runAction(actionBtn, () => window.qlex.removeDevice(actionBtn.dataset.id));
        else if (act === "refresh-pairing") void runAction(actionBtn, () => window.qlex.refreshPairing());
        return;
    }

    const autoBindBtn = target.closest("[data-auto-bind-sync]");
    if (autoBindBtn && state) {
        void runAction(autoBindBtn, () => window.qlex.bindRemoteProject(autoBindBtn.dataset.autoBindSync, autoBindBtn.dataset.autoBindDir), { success: "已自动绑定匹配目录并完成跨端同步" });
        return;
    }

    const bindBtn = target.closest("[data-bind-remote-project]");
    if (bindBtn && state) {
        void runAction(bindBtn, () => window.qlex.bindRemoteProject(bindBtn.dataset.bindRemoteProject), { success: "已将跨端共享项目绑定到本机目录" });
        return;
    }

    const strategyBtn = target.closest("[data-resolve-strategy]");
    if (strategyBtn && state) {
        const strat = strategyBtn.dataset.resolveStrategy;
        void runAction(strategyBtn, async () => {
            const res = await window.qlex.resolveAllSkillConflicts(strat);
            notify(`已按 ${strat} 基准解决 ${res.result?.resolvedCount || 0} 项冲突（旧版已备份）`);
            return res.state;
        });
        return;
    }

    const resolveBtn = target.closest("[data-resolve-skill]");
    if (resolveBtn && state) {
        const [name, sourceNs] = resolveBtn.dataset.resolveSkill.split(":");
        void runAction(resolveBtn, async () => {
            const res = await window.qlex.resolveSkillConflict(name, sourceNs);
            notify(`已以 ${sourceNs} 为准对齐「${name}」（更新 ${res.result?.updated || 0} 目录）`);
            return res.state;
        });
        return;
    }

    const nsChip = target.closest("[data-toggle-ns]");
    if (nsChip && state) {
        const ns = nsChip.dataset.toggleNs;
        const current = new Set(state.localSkillNamespaces || []);
        if (current.has(ns) && current.size > 1) current.delete(ns);
        else current.add(ns);
        void runAction(null, () => window.qlex.setSkillNamespaces([...current]));
        return;
    }

    const policyBtn = target.closest("[data-policy-toggle]");
    if (policyBtn && state) {
        const key = policyBtn.dataset.policyToggle;
        const cur = state.skillSyncPolicy || state.skills?.policy || { excludeHermesBundled: true, excludeHermesWebui: true };
        const nextVal = !cur[key];
        void runAction(policyBtn, () => window.qlex.setSkillSyncPolicy({ [key]: nextVal }), {
            success: nextVal ? "已开启自动跳过过滤" : "已关闭跳过过滤，纳入全量同步",
        });
        return;
    }

    const skillTabBtn = target.closest("[data-skill-tab]");
    if (skillTabBtn) {
        skillFilterTab = skillTabBtn.dataset.skillTab;
        renderXStage();
        return;
    }

    const excludeBtn = target.closest("[data-toggle-exclude-skill]");
    if (excludeBtn && state) {
        const [name, flag] = excludeBtn.dataset.toggleExcludeSkill.split(":");
        const excluded = flag === "1";
        void runAction(excludeBtn, () => window.qlex.toggleSkillExcluded(name, excluded), {
            success: excluded ? `已将「${name}」移出同步范围` : `已恢复「${name}」参与同步`,
        });
        return;
    }

    const memCatBtn = target.closest("[data-mem-cat]");
    if (memCatBtn) { memoryCategory = memCatBtn.dataset.memCat; memoryPreview = null; renderEStage(); return; }

    const memLvBtn = target.closest("[data-mem-level]");
    if (memLvBtn) {
        memoryRecallLevel = memLvBtn.dataset.memLevel;
        if (memoryRecallResult) {
            void window.qlex.memoryRecall({ query: memoryRecallQuery, level: memoryRecallLevel, targetLayer: memoryRecallLayer, tokenBudget: memoryRecallBudget, limit: 10 }).then(res => {
                memoryRecallResult = res;
                renderEStage();
            });
        } else renderEStage();
        return;
    }

    const memLayerBtn = target.closest("[data-mem-layer]");
    if (memLayerBtn) {
        memoryRecallLayer = memLayerBtn.dataset.memLayer;
        if (memoryRecallResult) {
            void window.qlex.memoryRecall({ query: memoryRecallQuery, level: memoryRecallLevel, targetLayer: memoryRecallLayer, tokenBudget: memoryRecallBudget, limit: 10 }).then(res => {
                memoryRecallResult = res;
                renderEStage();
            });
        } else renderEStage();
        return;
    }

    const memBudgetBtn = target.closest("[data-mem-budget]");
    if (memBudgetBtn) {
        memoryRecallBudget = Number(memBudgetBtn.dataset.memBudget) || 0;
        if (memoryRecallResult) {
            void window.qlex.memoryRecall({ query: memoryRecallQuery, level: memoryRecallLevel, targetLayer: memoryRecallLayer, tokenBudget: memoryRecallBudget, limit: 10 }).then(res => {
                memoryRecallResult = res;
                renderEStage();
            });
        } else renderEStage();
        return;
    }

    const browseUri = target.closest("[data-browse-uri]");
    if (browseUri) {
        const uri = browseUri.dataset.browseUri;
        void window.qlex.memoryBrowse({ uri, level: "L2" }).then(res => {
            memoryPreview = { kind: "items", key: res.item?.title || uri, uri: res.uri, content: res.content };
            renderEStage();
        }).catch(() => notify("无法读取该记忆详情"));
        return;
    }

    const readMem = target.closest("[data-read-memory]");
    if (readMem) {
        const [kind, ...rest] = readMem.dataset.readMemory.split(":");
        void window.qlex.readMemoryArchive(kind, rest.join(":")).then(entry => {
            memoryPreview = entry;
            renderEStage();
        }).catch(() => notify("无法读取该归档文件"));
        return;
    }

    const projDetailEl = target.closest("[data-project-detail]");
    if (projDetailEl) { projectDetail = projDetailEl.dataset.projectDetail; renderXStage(); return; }

    const presetBtn = target.closest("[data-theme-preset]");
    if (presetBtn) { void runAction(presetBtn, () => window.qlex.updateAppearance({ themePreset: presetBtn.dataset.themePreset })); return; }

    const insightsTabBtn = target.closest("[data-insights-tab]");
    if (insightsTabBtn) { insightsTab = insightsTabBtn.dataset.insightsTab; renderInsightsStage(); return; }

    const periodBtn = target.closest("[data-period]");
    if (periodBtn && state) {
        const next = Number(periodBtn.dataset.period);
        if (next <= 7 || state.usage?.history?.[next]) { period = next; renderInsightsStage(); }
        else void runAction(periodBtn, async () => { const res = await window.qlex.usagePeriod(next); period = next; return res; });
        return;
    }

    const slotPresetBtn = target.closest("[data-llm-slots]");
    if (slotPresetBtn) {
        const input = document.querySelector("#llmTimeSlotsInput");
        if (input) input.value = slotPresetBtn.dataset.llmSlots || "";
        return;
    }

    const railBtn = target.closest("[data-rail]");
    if (railBtn && state?.configured) {
        activeSection = railBtn.dataset.rail;
        projectDetail = "";
        render();
    }
});

function collectMemoryLlmFormValues() {
    const preset = document.querySelector("#llmPresetSelect")?.value || state?.centerMemoryLlm?.preset || "custom";
    const provider = document.querySelector("#llmProviderSelect")?.value || "openai-compatible";
    const baseUrl = document.querySelector("#llmBaseUrlInput")?.value?.trim() || "";
    const model = document.querySelector("#llmModelInput")?.value?.trim() || "";
    const rawKey = document.querySelector("#llmApiKeyInput")?.value?.trim() || "";
    const scheduleMode = document.querySelector("#llmScheduleModeSelect")?.value || "slots";
    const timeSlotsEl = document.querySelector("#llmTimeSlotsInput");
    const intervalEl = document.querySelector("#llmIntervalHoursInput");
    return {
        enabled: document.querySelector("#llmEnabledInput")?.checked !== false,
        onlyWhenChanged: document.querySelector("#llmOnlyChangedInput")?.checked !== false,
        preset,
        provider,
        baseUrl,
        model,
        apiKey: rawKey ? rawKey : "__KEEP__",
        scheduleMode,
        ...(timeSlotsEl ? { timeSlots: timeSlotsEl.value } : {}),
        ...(intervalEl ? { intervalHours: Number(intervalEl.value || 4) } : {}),
    };
}

document.addEventListener("change", (event) => {
    const t = event.target;
    if (t.name === "mode") {
        const box = document.querySelector("#onboardingInviteBox");
        if (box) box.classList.toggle("hidden", t.value !== "endpoint");
        return;
    }
    if (t.id === "llmPresetSelect") {
        const preset = state?.llmProviderPresets?.[t.value];
        if (preset) {
            const provSel = document.querySelector("#llmProviderSelect");
            const urlInp = document.querySelector("#llmBaseUrlInput");
            const modelInp = document.querySelector("#llmModelInput");
            if (provSel && preset.protocol) provSel.value = preset.protocol;
            if (urlInp && preset.baseUrl) urlInp.value = preset.baseUrl;
            if (modelInp && preset.defaultModel) modelInp.value = preset.defaultModel;
        }
        return;
    }
    if (t.id === "llmScheduleModeSelect") {
        const draft = collectMemoryLlmFormValues();
        if (state?.centerMemoryLlm) {
            state.centerMemoryLlm = { ...state.centerMemoryLlm, ...draft, scheduleMode: t.value };
        }
        renderEStage();
        return;
    }
    if (t.id === "centerAddress") { invitationAddress = t.value; return; }
    if (t.id === "sessionSourceFilter") { sessionSource = t.value; renderInsightsStage(); return; }
    if (t.id === "systemGlassInput") { void runAction(t, () => window.qlex.updateAppearance({ systemGlass: t.checked })); return; }
    if (t.id === "macBackdropSelect") { void runAction(t, () => window.qlex.updateAppearance({ macBackdrop: t.value, systemGlass: true })); return; }
    if (t.id === "edgeDockSelect") { void runAction(t, () => window.qlex.setEdgeDock(t.value)); return; }
    if (t.id === "edgeDockModeSelect") { void runAction(t, () => window.qlex.setEdgeDockMode(t.value)); return; }
    if (t.id === "alwaysOnTopInput") { void runAction(t, () => window.qlex.updateAppearance({ alwaysOnTop: t.checked })); return; }
    if (t.id === "keepRunningInput") { void runAction(t, () => window.qlex.setKeepRunning(t.checked)); return; }
    if (t.id === "skillSyncInput") { void runAction(t, () => window.qlex.setSkillSync(t.checked)); return; }
    if (t.id === "memoryAutoInput") { void runAction(t, () => window.qlex.setMemoryAutoCompress(t.checked)); return; }
    if (t.id === "updateChannelSelect") { void runAction(t, () => window.qlex.setUpdateChannel(t.value), { success: `已切换至 ${t.value === "beta" ? "Beta 尝鲜版" : "Stable 正式版"}通道` }); return; }
    if (t.id === "autoUpdatesInput") { void runAction(t, () => window.qlex.setAutoUpdates(t.checked)); return; }
});

document.addEventListener("input", (event) => {
    const t = event.target;
    if (t.id === "projectSearchInput") { projectQuery = t.value; renderXStage(); return; }
    if (t.id === "skillFilterInput") { skillFilterQuery = t.value; renderXStage(); return; }
    if (t.id === "glassOpacityRange") {
        const lbl = document.querySelector("#opacityValueLabel");
        if (lbl) lbl.textContent = `${t.value}%`;
        void window.qlex.updateAppearance({ glassOpacity: Number(t.value) });
        return;
    }
    if (t.id === "glassTintRange") {
        const lbl = document.querySelector("#tintValueLabel");
        if (lbl) lbl.textContent = `${t.value}%`;
        const key = state?.appearance?.macBackdrop === "liquid-glass-clear" ? "macClearGlassTint" : "macGlassTint";
        void window.qlex.updateAppearance({ [key]: Number(t.value) });
    }
});

document.addEventListener("submit", (event) => {
    const form = event.target;
    if (form.id === "memoryRecallForm") {
        event.preventDefault();
        memoryRecallQuery = document.querySelector("#memoryRecallInput")?.value || "";
        void window.qlex.memoryRecall({ query: memoryRecallQuery, level: memoryRecallLevel, targetLayer: memoryRecallLayer, tokenBudget: memoryRecallBudget, limit: 10 }).then(res => {
            memoryRecallResult = res;
            renderEStage();
        }).catch(() => notify("记忆检索失败"));
        return;
    }
    if (form.id === "memoryLlmForm") {
        event.preventDefault();
        const payload = collectMemoryLlmFormValues();
        void runAction(form.querySelector('button[type="submit"]'), async () => {
            const next = await window.qlex.setMemoryLlmConfig(payload);
            memoryLlmConfigOpen = false;
            notify("中心大模型记忆整理配置已保存");
            return next;
        });
        return;
    }
    if (form.id === "memoryRetainForm") {
        event.preventDefault();
        const content = document.querySelector("#retainContentInput")?.value?.trim();
        if (!content) return;
        const ttlRaw = document.querySelector("#retainTtlInput")?.value?.trim();
        const payload = {
            title: document.querySelector("#retainTitleInput")?.value?.trim() || "",
            content,
            bank: document.querySelector("#retainBankSelect")?.value || "",
            project: document.querySelector("#retainProjectInput")?.value?.trim() || "",
            factKey: document.querySelector("#retainFactKeyInput")?.value?.trim() || "",
            ttlDays: ttlRaw ? Number(ttlRaw) : undefined,
            source: "user",
            originChannel: "user",
        };
        void runAction(form.querySelector('button[type="submit"]'), async () => {
            const res = await window.qlex.memoryRetain(payload);
            memoryRetainOpen = false;
            const simHint = res.result?.similarTo?.length ? ` · 发现 ${res.result.similarTo.length} 条相似记忆` : "";
            notify(`原子记忆已保存（${res.result?.operation || "ADD"}${simHint}）`);
            return res.state;
        });
        return;
    }
    if (form.classList.contains("project-rename")) {
        event.preventDefault();
        const id = form.dataset.id;
        const name = form.querySelector("#projectRenameInput")?.value?.trim();
        if (!name) return;
        editingProject = "";
        void runAction(null, () => window.qlex.renameProject(id, name));
    }
});

window.qlex.onNativeMaterial?.((mat) => {
    const fp = JSON.stringify(mat || {});
    if (fp === lastMaterialFp) return;
    lastMaterialFp = fp;
    if (state) state.nativeMaterial = mat;
    window.QlexTheme?.applyNativeMaterial(mat);
});

window.qlex.onStateChanged?.((next) => {
    const activeEl = document.activeElement;
    const editingControl = activeEl?.tagName === "SELECT" || activeEl?.tagName === "TEXTAREA" || activeEl?.tagName === "INPUT";
    const updaterTick = next?.updater && JSON.stringify(next.updater) !== JSON.stringify(state?.updater);
    if ((!busy || updaterTick) && !editingProject && !editingControl && !memoryRetainOpen && !memoryLlmConfigOpen) {
        state = next;
        render();
    }
});

function openFromExternal(destination) {
    if (!state) { pendingDestination = destination; return; }
    if (!state.configured) { render(); return; }
    pendingDestination = null;
    memoryPreview = null;
    projectDetail = "";
    const map = {
        overview: "overview", home: "overview", Q: "overview",
        devices: "link", sync: "link", link: "link", L: "link",
        memory: "memory", E: "memory",
        projects: "workspace", skills: "workspace", workspace: "workspace", X: "workspace",
        status: "status",
        usage: "insights", limits: "insights", quota: "insights", sessions: "insights", trends: "insights", insights: "insights",
        settings: "settings",
    };
    activeSection = map[destination] || "overview";
    if (destination === "limits" || destination === "quota") insightsTab = "limits";
    else if (destination === "sessions") insightsTab = "sessions";
    else if (destination === "usage" || destination === "trends") insightsTab = "usage";
    render();
}

window.qlex.onNavigate?.(openFromExternal);
window.addEventListener("resize", () => { if (activeSection === "insights" && insightsTab === "usage") paintTrendCanvas(); });

setInterval(async () => {
    if (!state?.configured || state.pairing.mode === "local" || (activeSection !== "link" && activeSection !== "status") || busy || refreshing || document.hidden) return;
    if (["SELECT", "TEXTAREA", "INPUT"].includes(document.activeElement?.tagName)) return;
    refreshing = true;
    try {
        const next = await window.qlex.refreshPairing();
        if (!busy && JSON.stringify(state.pairing) !== JSON.stringify(next.pairing)) {
            state = next;
            render();
        }
    } catch { /* ignore */ }
    finally { refreshing = false; }
}, 4000);

(async () => {
    try {
        state = await window.qlex.getState();
        const mat = await window.qlex.getNativeMaterial();
        if (mat) state.nativeMaterial = mat;
        if (pendingDestination) openFromExternal(pendingDestination);
        else render();
    } catch {
        notify("无法读取 QLEX 本机状态，请重新打开应用。", 0);
    }
})();
