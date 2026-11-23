"use strict";

const shell = document.querySelector("#shell");
const liveDot = document.querySelector("#liveDot");
const rolePill = document.querySelector("#rolePill");
const periodTabs = document.querySelector("#periodTabs");
const onboardingPanel = document.querySelector("#onboardingPanel");
const settingsPanel = document.querySelector("#settingsPanel");
const totalPanel = document.querySelector("#totalPanel");
const totalLabel = document.querySelector("#totalLabel");
const usageUpdated = document.querySelector("#usageUpdated");
const totalTokensEl = document.querySelector("#totalTokens");
const totalCompactEl = document.querySelector("#totalCompact");
const totalSubline = document.querySelector("#totalSubline");
const searchToggleBtn = document.querySelector("#searchToggleBtn");
const viewBackRow = document.querySelector("#viewBackRow");
const backButton = document.querySelector("#backButton");
const backButtonLabel = document.querySelector("#backButtonLabel");
const viewHeaderActions = document.querySelector("#viewHeaderActions");
const searchHost = document.querySelector("#searchHost");
const searchInput = document.querySelector("#searchInput");
const sessionSourceFilter = document.querySelector("#sessionSourceFilter");
const homePanel = document.querySelector("#homePanel");
const mainListPanel = document.querySelector("#mainListPanel");
const limitsPanel = document.querySelector("#limitsPanel");
const trendsPanel = document.querySelector("#trendsPanel");
const footer = document.querySelector("#footer");
const viewSwitcher = document.querySelector("#viewSwitcher");
const viewSwitcherCurrent = document.querySelector("#viewSwitcherCurrent");
const viewSwitcherIcon = document.querySelector("#viewSwitcherIcon");
const viewSwitcherLabel = document.querySelector("#viewSwitcherLabel");
const viewSwitcherDisclosure = document.querySelector("#viewSwitcherDisclosure");
const viewSwitcherMenu = document.querySelector("#viewSwitcherMenu");
const syncStatusBtn = document.querySelector("#syncStatusBtn");
const syncRingGlyph = document.querySelector("#syncRingGlyph");
const syncStatusText = document.querySelector("#syncStatusText");
const settingsButton = document.querySelector("#settingsButton");
const pinButton = document.querySelector("#pinButton");
const dashButton = document.querySelector("#dashButton");
const minButton = document.querySelector("#minButton");
const closeButton = document.querySelector("#closeButton");
const noticeEl = document.querySelector("#notice");

const SOURCE_NAMES = {
    antigravity: "Antigravity",
    codex: "Codex",
    claude: "Claude Code",
    hermes: "Hermes",
    dsh: "DSH",
};
const ROLES = { local: "本机", center: "中心点", endpoint: "接入点" };
const PERIODS = { 1: "今日", 7: "近 7 天", 30: "近 30 天", 90: "近 90 天" };
const VIEWS = [
    { id: "home", label: "首页概览", icon: "icons/views/home.svg" },
    { id: "usage", label: "工具用量", icon: "icons/views/tool.svg" },
    { id: "limits", label: "订阅额度", icon: "icons/views/limits.svg" },
    { id: "memory", label: "记忆归档", icon: "icons/views/status.svg" },
    { id: "projects", label: "项目工作区", icon: "icons/views/project.svg" },
    { id: "sessions", label: "会话记录", icon: "icons/views/session.svg" },
    { id: "trends", label: "用量趋势", icon: "icons/views/trends.svg" },
    { id: "devices", label: "同步与技能", icon: "icons/views/device.svg" },
];

let state = null;
let view = "home";
let settingsOpen = false;
let openSettingsSection = "appearance";
let period = 7;
let busy = false;
let refreshing = false;
let joining = false;
let invitationAddress = "";
let expandedSource = "";
let projectDetail = "";
let projectQuery = "";
let editingProject = "";
let sessionSource = "";
let sessionProject = "";
let sessionLimit = 80;
let searchVisible = false;
let memoryCategory = "daily";
let memoryPreview = null;
let memoryRecallQuery = "";
let memoryRecallLevel = "L1";
let memoryRecallResult = null;
let memoryRetainOpen = false;
let noticeTimer = null;
let pendingDestination = null;
let displayedTotal = 0;
let numberAnimFrame = null;

const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtNum = (v) => v == null ? "—" : new Intl.NumberFormat("zh-CN").format(v);
const fmtCompact = (v) => {
    if (v == null || v < 1000) return "";
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
};
const fmtBytes = (b) => {
    if (!b) return "0 B";
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / (1024 * 1024)).toFixed(2)} MB`;
};
const fmtTime = (v) => v ? new Date(v).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const sourceColor = (src) => window.QlexTheme?.SOURCE_COLORS?.[src] || "var(--blue)";

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

function usageNotice() {
    if (state?.usage?.phase === "missing-engine") return "未检测到 Tokscale";
    if (state?.usage?.phase === "partial") return "部分采集";
    if (!state?.usage?.time) return "正在采集…";
    return fmtTime(state.usage.time);
}

function projectName(directory) {
    return state?.projects?.find(p => p.directory === directory)?.name
        || (selectedReport()?.projects || []).find(p => p.directory === directory)?.name
        || directory.split(/[\\/]/).filter(Boolean).at(-1)
        || directory;
}

let lastSyncPhase = "idle";
let lastOdoStr = "";
let stretchTimer = null;

function animateTotalNumber(target) {
    if (target == null || !Number.isFinite(target)) {
        totalTokensEl.textContent = "—";
        totalCompactEl.textContent = "";
        lastOdoStr = "";
        return;
    }
    const formatted = fmtNum(target);
    totalCompactEl.textContent = fmtCompact(target);
    if (formatted === lastOdoStr) return;

    // #29 Odometer: build vertical 0-9 reel for each digit; roll smoothly when length matches
    const chars = [...formatted];
    const existingSlots = [...totalTokensEl.children];
    const sameShape = existingSlots.length === chars.length &&
        chars.every((ch, i) => (/\d/.test(ch) ? existingSlots[i].classList.contains("odo-slot") : existingSlots[i].textContent === ch));

    if (!sameShape) {
        totalTokensEl.innerHTML = chars.map(ch => {
            if (!/\d/.test(ch)) return `<span class="odo-sep">${escapeHtml(ch)}</span>`;
            const digits = "0123456789".split("").map(d => `<span>${d}</span>`).join("");
            return `<span class="odo-slot"><span class="odo-reel" style="transform:translateY(-${Number(ch) * 1.08}em)">${digits}</span></span>`;
        }).join("");
    } else {
        chars.forEach((ch, i) => {
            if (/\d/.test(ch)) {
                const reel = existingSlots[i].querySelector(".odo-reel");
                if (reel) reel.style.transform = `translateY(-${Number(ch) * 1.08}em)`;
            }
        });
    }
    displayedTotal = target;
    lastOdoStr = formatted;
}

function syncGlyphSvg(phase) {
    if (phase === "syncing") {
        // #31 Eclipse Half rotating orbital arc
        return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-opacity="0.18" stroke-width="2"/><circle class="sync-eclipse-arc" cx="12" cy="12" r="8"/></svg>`;
    }
    if (phase === "synced") {
        // #21 Download Ring completion checkmark pop
        return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-opacity="0.28" stroke-width="1.8"/><path class="sync-check-path" d="M7.5 12.4 10.6 15.4 16.8 9"/></svg>`;
    }
    if (phase === "pending" || phase === "conflict") {
        return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v4.5M12 15.8h.01" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    }
    if (phase === "error") {
        return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9.5 9.5l5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24"><path d="M19 8a7.5 7.5 0 0 0-12-1L4 10m0 0V5m0 5h5m-4 6a7.5 7.5 0 0 0 12 1l3-3m0 0v5m0-5h-5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function updateLiveDotAndSyncButton() {
    const net = state.pairing;
    liveDot.classList.remove("live", "pending");
    if (net.mode === "center") {
        liveDot.classList.add(net.online ? "live" : "pending");
        liveDot.title = net.online ? "中心点在线" : "中心点未启动";
    } else if (net.mode === "endpoint") {
        liveDot.classList.add(net.endpoint?.status === "connected" && net.online ? "live" : "pending");
        liveDot.title = net.endpoint?.status === "pending" ? "等待中心确认" : net.online ? "已连接中心" : "中心暂不可达";
    } else {
        liveDot.classList.add("live");
        liveDot.title = "仅在本机运行";
    }
    rolePill.classList.toggle("hidden", !state.configured);
    rolePill.textContent = ROLES[net.mode] || "本机";
    pinButton.classList.toggle("active", Boolean(state.appearance?.alwaysOnTop));

    // #21/#31 Stateful sync pill button
    const st = state.syncStatus || { phase: "idle", label: "立即同步", detail: "" };
    const justCompleted = lastSyncPhase === "syncing" && st.phase === "synced";
    lastSyncPhase = st.phase;
    syncStatusBtn.className = `sync-status-btn phase-${st.phase}${justCompleted ? " just-synced" : ""}`;
    syncStatusBtn.disabled = st.phase === "syncing";
    if (syncRingGlyph) syncRingGlyph.innerHTML = syncGlyphSvg(st.phase);
    syncStatusText.textContent = st.label || "立即同步";
    syncStatusBtn.title = st.detail || "点击同步本机技能、配对与记忆归档";
}

function renderOnboarding() {
    onboardingPanel.innerHTML = `
      <div class="onboarding-hero">
        <img src="../../docs/assets/brand/logo.png" alt="" />
        <div>
          <h1>欢迎使用 QLEX</h1>
          <small>本地优先 AI 工作台 · 原生毛玻璃客户端</small>
        </div>
      </div>
      <div class="mode-list">
        <label class="mode-option">
          <input type="radio" name="mode" value="local" checked />
          <span><strong>仅在本机使用</strong><small>本机多工具用量、Skills 同步、每日/周/月记忆压缩归档与悬停侧边吸附。</small></span>
        </label>
        <label class="mode-option">
          <input type="radio" name="mode" value="center" />
          <span><strong>设为中心</strong><small>在本机启动 HTTPS 配对服务，邀请其他设备加入并同步 Skills。</small></span>
        </label>
        <label class="mode-option">
          <input type="radio" name="mode" value="endpoint" />
          <span><strong>加入中心</strong><small>粘贴中心设备生成的一次性邀请码完成安全配对。</small></span>
        </label>
      </div>
      <div id="onboardingInviteBox" class="hidden">
        <textarea id="invite" class="glass-textarea" maxlength="4200" spellcheck="false" placeholder="在中心设备复制配对邀请后粘贴到这里…"></textarea>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:4px">
        <button class="glass-btn primary" type="button" data-action="continue">开始使用</button>
      </div>
    `;
}

function renderSettings() {
    const a = state.appearance || {};
    const net = state.pairing;
    const mem = state.memoryArchive || {};
    const presetItems = Object.values(window.QlexTheme.PRESETS);
    const isGlass = a.macBackdrop === "liquid-glass" || a.macBackdrop === "liquid-glass-clear";
    const tintVal = a.macBackdrop === "liquid-glass-clear" ? (a.macClearGlassTint ?? 35) : (a.macGlassTint ?? 0);

    const section = (id, title, icon, summary, body) => {
        const expanded = openSettingsSection === id;
        return `<div class="settings-group">
          <button class="settings-section-toggle" type="button" data-settings-section="${id}" aria-expanded="${expanded}">
            <span class="settings-section-heading">
              <span class="mask-icon" style="-webkit-mask-image:url('${icon}');mask-image:url('${icon}')"></span>
              <span>${title}</span>
            </span>
            <span class="settings-section-meta">
              <span>${escapeHtml(summary)}</span>
              <span class="mask-icon" style="width:11px;height:11px;transform:${expanded ? "rotate(180deg)" : "none"};-webkit-mask-image:url('icons/actions/chevron-down.svg');mask-image:url('icons/actions/chevron-down.svg')"></span>
            </span>
          </button>
          <div class="settings-section-details ${expanded ? "" : "hidden"}">${body}</div>
        </div>`;
    };

    const backdropLabel = a.macBackdrop === "liquid-glass" ? "液态玻璃" : a.macBackdrop === "liquid-glass-clear" ? "清透液态玻璃" : "经典毛玻璃";
    const appearanceBody = `
      <div class="settings-item-col">
        <span class="settings-item-title">界面主题配色</span>
        <div class="theme-swatches">
          ${presetItems.map(p => `
            <button type="button" class="theme-swatch ${a.themePreset === p.id ? "active" : ""}" data-theme-preset="${p.id}">
              <span class="theme-swatch-dot" style="background:${p.bg};box-shadow:inset 0 0 0 2px ${p.accent}"></span>
              <span>${p.name}</span>
            </button>
          `).join("")}
        </div>
      </div>
      <div class="settings-item">
        <span class="settings-item-title">系统毛玻璃材质</span>
        <input id="systemGlassInput" class="settings-switch" type="checkbox" ${a.systemGlass !== false ? "checked" : ""} />
      </div>
      ${state.platform === "darwin" ? `
        <div class="settings-item">
          <span class="settings-item-title">macOS 背景材质</span>
          <select id="macBackdropSelect" class="glass-select" ${a.systemGlass === false ? "disabled" : ""}>
            <option value="vibrancy" ${a.macBackdrop === "vibrancy" ? "selected" : ""}>经典毛玻璃 (HUD)</option>
            ${state.liquidGlassSupported ? `
              <option value="liquid-glass" ${a.macBackdrop === "liquid-glass" ? "selected" : ""}>液态玻璃 (Liquid Glass)</option>
              <option value="liquid-glass-clear" ${a.macBackdrop === "liquid-glass-clear" ? "selected" : ""}>清透液态玻璃 (Clear)</option>
            ` : ""}
          </select>
        </div>
      ` : ""}
      ${isGlass && a.systemGlass !== false ? `
        <div class="settings-item-col">
          <div style="display:flex;justify-content:space-between"><span class="settings-item-title">液态玻璃染色深度</span><span class="settings-note" id="tintValueLabel">${tintVal}%</span></div>
          <input id="glassTintRange" class="glass-range" type="range" min="0" max="85" value="${tintVal}" />
        </div>
      ` : `
        <div class="settings-item-col">
          <div style="display:flex;justify-content:space-between"><span class="settings-item-title">毛玻璃不透明度</span><span class="settings-note" id="opacityValueLabel">${a.glassOpacity ?? 68}%</span></div>
          <input id="glassOpacityRange" class="glass-range" type="range" min="20" max="100" value="${a.glassOpacity ?? 68}" />
        </div>
      `}
    `;

    const dockSummary = state.edgeDock === "left" ? "左侧" : state.edgeDock === "right" ? "右侧" : "关闭";
    const windowBody = `
      <div class="settings-item">
        <span class="settings-item-title">侧边吸附位置</span>
        <select id="edgeDockSelect" class="glass-select">
          <option value="off" ${!state.edgeDock || state.edgeDock === "off" ? "selected" : ""}>关闭</option>
          <option value="left" ${state.edgeDock === "left" ? "selected" : ""}>屏幕左侧</option>
          <option value="right" ${state.edgeDock === "right" ? "selected" : ""}>屏幕右侧</option>
        </select>
      </div>
      <div class="settings-item">
        <span class="settings-item-title">侧边吸附弹出方式</span>
        <select id="edgeDockModeSelect" class="glass-select">
          <option value="autoHide" ${state.edgeDockMode !== "always" ? "selected" : ""}>鼠标悬浮弹出（默认）</option>
          <option value="always" ${state.edgeDockMode === "always" ? "selected" : ""}>始终停靠显示</option>
        </select>
      </div>
      <div class="settings-item">
        <span class="settings-item-title">窗口置顶显示</span>
        <input id="alwaysOnTopInput" class="settings-switch" type="checkbox" ${a.alwaysOnTop ? "checked" : ""} />
      </div>
      <div class="settings-item">
        <span class="settings-item-title">关闭窗口后后台常驻</span>
        <input id="keepRunningInput" class="settings-switch" type="checkbox" ${state.keepRunning && state.trayAvailable ? "checked" : ""} ${state.trayAvailable ? "" : "disabled"} />
      </div>
      <div class="settings-note">默认收起为屏幕边缘细条，鼠标悬浮其上自动弹出毛玻璃轨道与快览气泡，移开自动收回。</div>
    `;

    const syncBody = `
      <div class="settings-item">
        <span class="settings-item-title">自动同步 Skills</span>
        <input id="skillSyncInput" class="settings-switch" type="checkbox" ${state.skillSyncEnabled ? "checked" : ""} />
      </div>
      <div class="settings-item">
        <span class="settings-item-title">每日/周/月记忆自动压缩</span>
        <input id="memoryAutoInput" class="settings-switch" type="checkbox" ${state.memoryAutoCompress !== false ? "checked" : ""} />
      </div>
      <div class="memory-path-line">归档目录：${escapeHtml(mem.archiveDir || state.memoryArchiveDir || "")}</div>
      <div class="row-actions-inline">
        <button type="button" class="glass-btn sm" data-action="choose-memory-dir">更改归档目录</button>
        <button type="button" class="glass-btn sm" data-action="open-memory-dir">打开目录 ↗</button>
        <button type="button" class="glass-btn sm" data-jump-view="devices">技能与设备 ↗</button>
      </div>
    `;

    settingsPanel.innerHTML =
        section("appearance", "外观与毛玻璃", "icons/settings/appearance.svg", backdropLabel, appearanceBody) +
        section("window", "窗口与侧边吸附", "icons/settings/window.svg", `${dockSummary} · ${state.edgeDockMode === "always" ? "常驻" : "悬停"}`, windowBody) +
        section("sync", "技能同步与记忆归档", "icons/settings/sync.svg", ROLES[net.mode], syncBody);
}

function renderHome() {
    const report = selectedReport();
    const net = state.pairing;
    const quota = state.usage?.quotas?.codex;
    const sk = state.skills || {};
    const mem = state.memoryArchive || {};
    const st = state.syncStatus || { phase: "idle", label: "待同步" };

    const syncDotColor = st.phase === "synced" ? "var(--success)"
        : st.phase === "syncing" ? "var(--blue)"
        : st.phase === "error" ? "var(--red)" : "var(--orange)";

    const toolRows = Object.entries(SOURCE_NAMES)
        .map(([key, label]) => ({ key, label, tokens: report?.totals?.[key]?.tokens || 0, sessions: report?.totals?.[key]?.sessions || 0 }))
        .sort((a, b) => b.tokens - a.tokens)
        .slice(0, 4);

    const limitPreviewHtml = quota?.windows?.length
        ? quota.windows.map(w => {
            const expired = w.resetsAt && w.resetsAt <= Date.now();
            const rem = expired ? 100 : Math.max(0, Math.min(100, Math.round(100 - w.used)));
            const cls = rem <= 15 ? "danger" : rem <= 35 ? "warn" : "";
            return `<div style="display:grid;gap:4px">
              <div class="limit-window-text">
                <span class="home-list-sub">${w.minutes ? `${fmtNum(w.minutes)} 分钟窗口` : "Codex 额度"}</span>
                <span class="home-list-value">${expired ? "已重置" : `${rem}% 剩余`}</span>
              </div>
              <div class="limit-meter"><div class="limit-meter-fill ${cls}" style="width:${rem}%"></div></div>
            </div>`;
        }).join("")
        : `<div class="home-list-sub">暂无本机 Codex 额度采样</div>`;

    const c = mem.counts || { daily: 0, weekly: 0, monthly: 0 };
    const cog = mem.cognitive || { activeItems: 0, entities: 0, activeEdges: 0, reflectionsCount: 0 };
    const memSkill = state.memorySkill || { installedCount: 0, totalCount: 6 };

    homePanel.innerHTML = `
      <div class="home-module">
        <div class="home-module-head" data-jump-view="devices">
          <span class="home-module-label">同步与本机 SKILLS</span>
          <span class="home-module-meta">${escapeHtml(st.label)} ›</span>
        </div>
        <div class="home-list-row" data-jump-view="devices">
          <span class="home-dot" style="background:${syncDotColor}"></span>
          <div class="home-list-main">
            <span class="home-list-name">${ROLES[net.mode]} · 本机 ${sk.uniqueSkills ?? 0} 项技能</span>
            <span class="home-list-sub">${sk.conflicts > 0 ? `发现 ${sk.conflicts} 项版本冲突，点击进入一键解决` : sk.missingLinks > 0 ? `${sk.missingLinks} 项跨工具技能待同步对齐` : "本机多工具技能已对齐"}</span>
          </div>
          <button type="button" class="glass-btn sm" data-action="sync-local-skills">同步技能</button>
        </div>
      </div>

      <div class="home-module">
        <div class="home-module-head" data-jump-view="memory">
          <span class="home-module-label">认知记忆与知识图谱</span>
          <span class="home-module-meta">Agent 技能 ${memSkill.installedCount}/${memSkill.totalCount} ›</span>
        </div>
        <div class="home-list-row" data-jump-view="memory">
          <span class="home-dot" style="background:var(--purple)"></span>
          <div class="home-list-main">
            <span class="home-list-name">记忆 ${cog.activeItems ?? 0} · 图谱 ${cog.entities ?? 0} 实体/${cog.activeEdges ?? 0} 边</span>
            <span class="home-list-sub">每日 ${c.daily} · 每周 ${c.weekly} · 每月 ${c.monthly} · 压缩率 ${mem.compressionRatio ?? 0}%</span>
          </div>
          <button type="button" class="glass-btn sm" data-action="compress-memory">压缩</button>
        </div>
      </div>

      <div class="home-module">
        <div class="home-module-head" data-jump-view="usage">
          <span class="home-module-label">工具用量</span>
          <span class="home-module-meta">${PERIODS[period]} ›</span>
        </div>
        ${toolRows.map(t => `
          <div class="home-list-row" data-jump-tool="${t.key}">
            <span class="home-dot" style="background:${sourceColor(t.key)}"></span>
            <div class="home-list-main">
              <span class="home-list-name">${t.label}</span>
              <span class="home-list-sub">${fmtNum(t.sessions)} 次会话</span>
            </div>
            <span class="home-list-value">${fmtNum(t.tokens)}</span>
          </div>
        `).join("")}
      </div>

      <div class="home-module">
        <div class="home-module-head" data-jump-view="limits">
          <span class="home-module-label">订阅额度</span>
          <span class="home-module-meta">Codex ›</span>
        </div>
        ${limitPreviewHtml}
      </div>

      <div class="home-module">
        <div class="quick-actions-row">
          <button type="button" class="quick-chip" data-action="open-dashboard">
            <div><strong>大屏看板</strong><small>完整图表与分布</small></div>
            <span>↗</span>
          </button>
          <button type="button" class="quick-chip" data-action="open-memory-dir">
            <div><strong>归档目录</strong><small>日/周/月压缩文件</small></div>
            <span>↗</span>
          </button>
        </div>
      </div>
    `;
}

function renderMemoryArchiveView() {
    const mem = state.memoryArchive || { counts: { daily: 0, weekly: 0, monthly: 0 }, items: { daily: [], weekly: [], monthly: [] } };
    const c = mem.counts || { daily: 0, weekly: 0, monthly: 0 };
    const cog = mem.cognitive || { activeItems: 0, supersededItems: 0, entities: 0, activeEdges: 0, historicalEdges: 0, reflectionsCount: 0, banks: {} };
    const memSkill = state.memorySkill || { installedCount: 0, upToDateCount: 0, totalCount: 6 };

    if (memoryPreview) {
        mainListPanel.innerHTML = `
          <div class="row">
            <div class="row-head">
              <span class="row-title">${escapeHtml(memoryPreview.key)}</span>
              <div class="row-actions-inline" style="margin:0">
                ${memoryPreview.mdPath ? `<button type="button" class="glass-btn sm" data-action="open-memory-file" data-kind="${escapeHtml(memoryPreview.kind)}" data-key="${escapeHtml(memoryPreview.key)}">外部打开 ↗</button>` : ""}
                <button type="button" class="glass-btn sm" data-action="close-memory-preview">返回</button>
              </div>
            </div>
            <div class="row-subtitle">${memoryPreview.uri ? escapeHtml(memoryPreview.uri) : `原始 ${fmtBytes(memoryPreview.rawBytes)} → gzip ${fmtBytes(memoryPreview.compressedBytes)}`}</div>
            <pre class="memory-preview-box">${escapeHtml(memoryPreview.content)}</pre>
          </div>
        `;
        return;
    }

    const catOrder = ["daily", "weekly", "monthly", "graph", "reflections"];
    const segIdx = Math.max(0, catOrder.indexOf(memoryCategory));
    const list = mem.items?.[memoryCategory] || [];

    const recallSection = `
      <div class="row">
        <div class="row-head">
          <span class="row-title">记忆检索 · OpenViking 分层召回</span>
          <div class="level-pills" role="group" aria-label="OpenViking 详情层级">
            ${["L0", "L1", "L2"].map(lv => `<button type="button" class="level-pill ${memoryRecallLevel === lv ? "active" : ""}" data-mem-level="${lv}">${lv}</button>`).join("")}
          </div>
        </div>
        <form id="memoryRecallForm" class="mem-search-bar">
          <input id="memoryRecallInput" class="glass-input" type="search" value="${escapeHtml(memoryRecallQuery)}" placeholder="检索决策 / 偏好 / 经验 / 实体…" />
          <button type="submit" class="glass-btn sm primary">检索</button>
        </form>
        ${memoryRecallResult ? `
          <div class="row-subtitle">命中 ${memoryRecallResult.results.length}/${memoryRecallResult.totalMatched} 条（${memoryRecallResult.level}）${memoryRecallResult.graphContext?.length ? ` · 关联图谱边 ${memoryRecallResult.graphContext.length}` : ""}</div>
          ${memoryRecallResult.results.length ? memoryRecallResult.results.slice(0, 8).map(r => `
            <div class="mem-result-card" data-browse-uri="${escapeHtml(r.uri)}">
              <div class="row-head">
                <span class="row-title">${escapeHtml(r.title)}</span>
                <span class="mem-badge accent">${escapeHtml(r.bank)} · ${r.score}</span>
              </div>
              <div class="mem-uri">${escapeHtml(r.uri)}</div>
              <div class="mem-result-body">${escapeHtml(memoryRecallLevel === "L0" ? r.l0 : memoryRecallLevel === "L1" ? (r.l1 || r.l0) : (r.l2 || r.l1 || r.l0))}</div>
            </div>
          `).join("") : `<div class="row-subtitle">未检索到相关记忆，试试其他关键词或先点击「压缩归档」。</div>`}
        ` : ""}
      </div>
    `;

    const retainFormHtml = memoryRetainOpen ? `
      <form id="memoryRetainForm" class="mem-retain-form">
        <div class="row-head">
          <span class="row-title">写入原子记忆 (Mem0 + Graphiti)</span>
          <button type="button" class="glass-btn sm" data-action="toggle-retain-form">收起</button>
        </div>
        <input id="retainTitleInput" class="glass-input" placeholder="标题（可选，自动提取）" maxlength="90" />
        <textarea id="retainContentInput" class="glass-textarea" placeholder="记录偏好、架构决策、排错经验或变更（支持「从 A 改用 B」自动演进图谱）…" required></textarea>
        <div class="mem-retain-row">
          <select id="retainBankSelect" class="glass-select">
            <option value="">自动判别分区</option>
            <option value="world">world · 事实/决策</option>
            <option value="experience">experience · 经验/排错</option>
            <option value="opinion">opinion · 偏好/观点</option>
          </select>
          <input id="retainProjectInput" class="glass-input" placeholder="所属项目（可选）" maxlength="64" />
        </div>
        <input id="retainFactKeyInput" class="glass-input" placeholder="Fact Key（可选，同 Key 新事实自动 SUPERSEDE 旧事实）" maxlength="64" />
        <div class="row-actions-inline">
          <button type="submit" class="glass-btn sm primary">保存并更新图谱</button>
        </div>
      </form>
    ` : "";

    let tabBody = "";
    if (memoryCategory === "graph") {
        tabBody = `
          <div class="row">
            <div class="row-head">
              <span class="row-title">双时态知识图谱 (Cognee + Graphiti)</span>
              <span class="row-cost">${cog.entities} 实体 · ${cog.activeEdges} 边</span>
            </div>
            <div class="row-subtitle">历史演进边 ${cog.historicalEdges} 条 · 已替代记忆 ${cog.supersededItems} 条</div>
            <div class="row-actions-inline">
              <button type="button" class="glass-btn sm primary" data-read-memory="graph:graph">查看完整图谱与演进链</button>
              <button type="button" class="glass-btn sm" data-read-memory="items:">浏览原子记忆</button>
            </div>
          </div>
        `;
    } else if (memoryCategory === "reflections") {
        tabBody = `
          <div class="row">
            <div class="row-head">
              <span class="row-title">反思洞察与心智模型 (Hindsight)</span>
              <span class="row-cost">${cog.reflectionsCount || 0} 条</span>
            </div>
            <div class="row-subtitle">基于已有事实、偏好与演进链自动合成证据化观察与项目心智模型</div>
            <div class="row-actions-inline">
              <button type="button" class="glass-btn sm primary" data-action="reflect-memory">✦ 立即执行反思 (Reflect)</button>
              <button type="button" class="glass-btn sm" data-read-memory="reflections:reflections">查看反思报告</button>
            </div>
          </div>
        `;
    } else {
        tabBody = list.length ? list.map(item => `
          <div class="row clickable" data-read-memory="${memoryCategory}:${escapeHtml(item.key)}">
            <div class="row-head">
              <div class="row-name">
                <span class="home-dot" style="background:${memoryCategory === "daily" ? "var(--accent)" : memoryCategory === "weekly" ? "var(--blue)" : "var(--purple)"}"></span>
                <div style="min-width:0">
                  <div class="row-title">${escapeHtml(item.label)}</div>
                  <div class="row-subtitle">${escapeHtml(item.sub)}</div>
                </div>
              </div>
              <div class="row-metrics">
                <div class="row-value">${fmtBytes(item.compressedBytes)}</div>
                <div class="row-cost">.md + .gz</div>
              </div>
            </div>
          </div>
        `).join("") : `<div class="empty-state">暂无「${memoryCategory === "daily" ? "每日" : memoryCategory === "weekly" ? "每周" : "每月"}」压缩归档。<br/>点击上方「立即压缩归档」即可自动生成并归类保存。</div>`;
    }

    mainListPanel.innerHTML = `
      <div class="row">
        <div class="row-head">
          <span class="row-title">QLEX 认知记忆引擎 v2</span>
          <span class="row-cost">压缩率 ${mem.compressionRatio ?? 0}%</span>
        </div>
        <div class="mem-badge-row">
          <span class="mem-badge">Mem0</span>
          <span class="mem-badge">Hindsight</span>
          <span class="mem-badge">memU</span>
          <span class="mem-badge">Cognee</span>
          <span class="mem-badge">Graphiti</span>
          <span class="mem-badge">OpenViking</span>
        </div>
        <div class="mem-stat-pills">
          <div class="mem-stat-chip"><span>活跃记忆</span><strong>${fmtNum(cog.activeItems || 0)}</strong></div>
          <div class="mem-stat-chip"><span>图谱实体/边</span><strong>${fmtNum(cog.entities || 0)}/${fmtNum(cog.activeEdges || 0)}</strong></div>
          <div class="mem-stat-chip"><span>Agent 技能</span><strong>${memSkill.installedCount}/${memSkill.totalCount}</strong></div>
        </div>
        <div class="memory-path-line">${escapeHtml(mem.archiveDir || state.memoryArchiveDir || "")}</div>
        <div class="row-actions-inline">
          <button type="button" class="glass-btn sm primary" data-action="compress-memory">${mem.phase === "compressing" ? "压缩中…" : "⚡ 压缩归档"}</button>
          <button type="button" class="glass-btn sm" data-action="install-memory-skill">✦ 部署 Agent 技能</button>
          <button type="button" class="glass-btn sm" data-action="toggle-retain-form">+ 写入记忆</button>
          <button type="button" class="glass-btn sm" data-action="reflect-memory">反思</button>
          <button type="button" class="glass-btn sm" data-action="open-memory-dir">目录 ↗</button>
        </div>
      </div>

      ${retainFormHtml}
      ${recallSection}

      <div class="seg-pills seg-5" style="--seg-index:${segIdx}" role="tablist" aria-label="记忆归档分类">
        <span class="seg-pill-indicator" aria-hidden="true"></span>
        <button type="button" class="seg-pill ${memoryCategory === "daily" ? "active" : ""}" data-mem-cat="daily">日(${c.daily})</button>
        <button type="button" class="seg-pill ${memoryCategory === "weekly" ? "active" : ""}" data-mem-cat="weekly">周(${c.weekly})</button>
        <button type="button" class="seg-pill ${memoryCategory === "monthly" ? "active" : ""}" data-mem-cat="monthly">月(${c.monthly})</button>
        <button type="button" class="seg-pill ${memoryCategory === "graph" ? "active" : ""}" data-mem-cat="graph">图谱</button>
        <button type="button" class="seg-pill ${memoryCategory === "reflections" ? "active" : ""}" data-mem-cat="reflections">反思</button>
      </div>

      ${tabBody}
    `;
}

function renderUsageList() {
    const report = selectedReport();
    const entries = Object.entries(SOURCE_NAMES)
        .map(([key, label]) => ({
            key,
            label,
            stats: report?.totals?.[key] || { tokens: 0, sessions: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }))
        .sort((a, b) => b.stats.tokens - a.stats.tokens);
    const maxTokens = Math.max(1, ...entries.map(e => e.stats.tokens));

    mainListPanel.innerHTML = entries.map(({ key, label, stats }) => {
        const pct = Math.round((stats.tokens / maxTokens) * 100);
        const expanded = expandedSource === key;
        return `<div class="row clickable" data-toggle-source="${key}">
          <div class="row-head">
            <div class="row-name">
              <span class="home-dot" style="background:${sourceColor(key)}"></span>
              <div style="min-width:0">
                <div class="row-title">${label}</div>
                <div class="row-subtitle">${fmtNum(stats.sessions)} 次会话</div>
              </div>
            </div>
            <div class="row-metrics">
              <div class="row-value">${fmtNum(stats.tokens)}</div>
              <div class="row-cost">${fmtCompact(stats.tokens) || "tok"}</div>
            </div>
          </div>
          <div class="bar"><div class="bar-fill" style="width:${pct}%;background:${sourceColor(key)}"></div></div>
          ${expanded ? `<div class="row-detail-drawer">
            <div class="detail-kv-grid">
              <div>输入 <strong>${fmtNum(stats.input)}</strong></div>
              <div>输出 <strong>${fmtNum(stats.output)}</strong></div>
              <div>缓存读 <strong>${fmtNum(stats.cacheRead)}</strong></div>
              <div>缓存写 <strong>${fmtNum(stats.cacheWrite)}</strong></div>
            </div>
            <div class="row-actions-inline">
              <button type="button" class="glass-btn sm" data-session-source="${key}">查看该工具会话 →</button>
            </div>
          </div>` : ""}
        </div>`;
    }).join("");
}

function renderLimits() {
    const codex = state.usage?.quotas?.codex;
    if (!codex?.windows?.length) {
        limitsPanel.innerHTML = `<div class="empty-state">暂无本机订阅额度数据。<br/>使用 Codex 后会自动从本机 rollout 日志采集剩余额度。</div>`;
        return;
    }
    // #30 Tide Progress liquid wave orbs + detailed reset captions
    limitsPanel.innerHTML = `
      <div class="limit-head">
        <div class="limit-name"><span class="home-dot" style="background:${sourceColor("codex")}"></span>Codex 订阅窗口</div>
        <span class="limit-meta">采样于 ${fmtTime(codex.time)}</span>
      </div>
      <div class="tide-orbs-grid">
        ${codex.windows.map(w => {
            const expired = w.resetsAt && w.resetsAt <= Date.now();
            const rem = expired ? 100 : Math.max(0, Math.min(100, Math.round(100 - w.used)));
            const cls = rem <= 15 ? "danger" : rem <= 35 ? "warn" : "";
            return `<div class="tide-card">
              <div class="tide-orb ${cls}" style="--tide-pct:${rem}%">
                <div class="tide-wave-wrap">
                  <svg class="tide-wave-svg" viewBox="0 0 120 12" preserveAspectRatio="none">
                    <path d="M0 6 Q 15 0, 30 6 T 60 6 T 90 6 T 120 6 V 12 H 0 Z"/>
                  </svg>
                </div>
                <span class="tide-pct-label">${expired ? "100%" : `${rem}%`}</span>
              </div>
              <strong style="font-size:0.6875rem">${w.minutes ? `${fmtNum(w.minutes)} 分钟窗口` : "当前周期"}</strong>
              <span class="limit-meta">${expired ? "窗口已重置" : w.resetsAt ? `重置 ${fmtTime(w.resetsAt)}` : "剩余额度"}</span>
            </div>`;
        }).join("")}
      </div>
    `;
}

function renderProjects() {
    if (projectDetail) {
        const pathEsc = escapeHtml(projectDetail);
        const proj = (selectedReport()?.projects || []).find(p => p.directory === projectDetail);
        const managed = state.projects.find(p => p.directory === projectDetail);
        mainListPanel.innerHTML = `
          <div class="row">
            <div class="row-title" style="font-size:0.875rem;font-weight:600">${escapeHtml(projectName(projectDetail))}</div>
            <div class="row-subtitle" style="white-space:normal;overflow-wrap:anywhere">${pathEsc}</div>
            <div class="detail-kv-grid" style="margin-top:6px">
              <div>${PERIODS[period]} Token <strong>${fmtNum(proj?.tokens)}</strong></div>
              <div>会话数 <strong>${fmtNum(proj?.sessions)}</strong></div>
            </div>
            <div class="row-subtitle">工具：${(proj?.sources || []).map(s => SOURCE_NAMES[s] || s).join(" · ") || "—"}</div>
            <div class="row-actions-inline" style="margin-top:6px">
              ${managed
                  ? `<button type="button" class="glass-btn sm" data-action="open-project" data-id="${escapeHtml(managed.id)}">打开目录</button>`
                  : `<button type="button" class="glass-btn sm" data-action="open-discovered-project" data-directory="${pathEsc}">打开目录</button>
                     <button type="button" class="glass-btn sm" data-action="add-discovered-project" data-directory="${pathEsc}">登记项目</button>`}
              <button type="button" class="glass-btn sm primary" data-project-sessions="${pathEsc}">查看会话</button>
            </div>
          </div>
        `;
        return;
    }

    const q = projectQuery.trim().toLowerCase();
    const managed = state.projects.filter(p => !q || p.name.toLowerCase().includes(q) || p.directory.toLowerCase().includes(q));
    const managedSet = new Set(state.projects.map(p => p.directory));
    const discovered = (state.usage?.week?.projects || []).filter(p =>
        !managedSet.has(p.directory) && (!q || p.name.toLowerCase().includes(q) || p.directory.toLowerCase().includes(q))
    );

    const managedHtml = managed.length ? managed.map(p => {
        const id = escapeHtml(p.id);
        const name = escapeHtml(p.name);
        if (editingProject === p.id) {
            return `<div class="row">
              <form class="project-rename" data-id="${id}" style="display:flex;gap:5px">
                <input id="projectRenameInput" class="glass-input" style="flex:1;min-width:0" value="${name}" maxlength="120" required />
                <button type="submit" class="glass-btn sm primary">保存</button>
                <button type="button" class="glass-btn sm" data-action="cancel-rename">取消</button>
              </form>
              <div class="row-subtitle">${escapeHtml(p.directory)}</div>
            </div>`;
        }
        return `<div class="row">
          <div class="row-head">
            <div class="row-name clickable" data-project-detail="${escapeHtml(p.directory)}" style="cursor:pointer">
              <span class="home-dot" style="background:var(--accent)"></span>
              <div style="min-width:0">
                <div class="row-title">${name}</div>
                <div class="row-subtitle">${escapeHtml(p.directory)}</div>
              </div>
            </div>
          </div>
          <div class="row-actions-inline">
            <button type="button" class="glass-btn sm" data-action="open-project" data-id="${id}">打开</button>
            <button type="button" class="glass-btn sm" data-action="rename-project" data-id="${id}">重命名</button>
            <button type="button" class="glass-btn sm danger" data-action="remove-project" data-id="${id}">移出</button>
          </div>
        </div>`;
    }).join("") : `<div class="empty-state">尚未登记本机项目。点击右上角「+ 添加」或从下方自动发现添加。</div>`;

    const discoveredHtml = discovered.length ? `
      <div class="home-module-label" style="margin-top:6px">自动发现的工作区（近 7 天）</div>
      ${discovered.slice(0, 40).map(p => `
        <div class="row">
          <div class="row-head">
            <div class="row-name clickable" data-project-detail="${escapeHtml(p.directory)}" style="cursor:pointer">
              <span class="home-dot" style="background:${sourceColor(p.sources?.[0])}"></span>
              <div style="min-width:0">
                <div class="row-title">${escapeHtml(p.name)}</div>
                <div class="row-subtitle">${p.sources.map(s => SOURCE_NAMES[s] || s).join(" · ")} · ${fmtNum(p.tokens)} tok</div>
              </div>
            </div>
            <button type="button" class="glass-btn sm" data-action="add-discovered-project" data-directory="${escapeHtml(p.directory)}">+ 登记</button>
          </div>
        </div>
      `).join("")}` : "";

    mainListPanel.innerHTML = managedHtml + discoveredHtml;
}

function renderSessions() {
    const q = projectQuery.trim().toLowerCase();
    const sessions = (selectedReport()?.sessions || []).filter(s =>
        (!sessionSource || s.source === sessionSource)
        && (!sessionProject || s.workspace === sessionProject)
        && (!q || (s.workspace || "").toLowerCase().includes(q) || (SOURCE_NAMES[s.source] || s.source).toLowerCase().includes(q))
    );
    if (!sessions.length) {
        mainListPanel.innerHTML = `<div class="empty-state">当前条件下暂无会话记录。</div>`;
        return;
    }
    const maxTok = Math.max(1, ...sessions.slice(0, sessionLimit).map(s => s.tokens));
    mainListPanel.innerHTML = sessions.slice(0, sessionLimit).map(s => `
      <div class="row ${s.workspace ? "clickable" : ""}" ${s.workspace ? `data-project-detail="${escapeHtml(s.workspace)}"` : ""}>
        <div class="row-head">
          <div class="row-name">
            <span class="home-dot" style="background:${sourceColor(s.source)}"></span>
            <div style="min-width:0">
              <div class="row-title">${escapeHtml(s.workspace ? projectName(s.workspace) : "未归属工作区")}</div>
              <div class="row-subtitle">${SOURCE_NAMES[s.source] || s.source} · ${fmtTime(s.lastActive)}</div>
            </div>
          </div>
          <div class="row-metrics">
            <div class="row-value">${fmtNum(s.tokens)}</div>
            <div class="row-cost">${fmtCompact(s.tokens) || "tok"}</div>
          </div>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${Math.round((s.tokens / maxTok) * 100)}%;background:${sourceColor(s.source)}"></div></div>
      </div>
    `).join("") + (sessions.length > sessionLimit
        ? `<button type="button" class="glass-btn" data-action="more-sessions" style="margin-top:4px">加载更多（剩余 ${fmtNum(sessions.length - sessionLimit)} 条）</button>`
        : "");
}

function trendRows() {
    const report = selectedReport();
    if (period !== 1) return report?.daily || [];
    if (!report) return [];
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    return [{ date, tokens: report.total }];
}

function renderTrends() {
    const rows = trendRows();
    trendsPanel.innerHTML = `
      <div class="trend-canvas-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span class="home-module-label">每日 Token 柱状图</span>
          <button type="button" class="glass-btn sm" data-action="open-dashboard-trends">大屏分析 ↗</button>
        </div>
        ${rows.length ? `<canvas id="trendChart"></canvas>` : `<div class="empty-state">当前范围暂无每日趋势数据</div>`}
      </div>
      ${rows.length ? `<div class="breakdown">${[...rows].reverse().slice(0, 14).map(r => `
        <div class="row" style="padding-bottom:6px">
          <div class="row-head">
            <span class="row-subtitle">${escapeHtml(r.date)}</span>
            <span class="row-value">${fmtNum(r.tokens)}</span>
          </div>
        </div>`).join("")}</div>` : ""}
    `;
    paintTrendCanvas();
}

function paintTrendCanvas() {
    const canvas = document.querySelector("#trendChart");
    if (!canvas) return;
    const rows = trendRows();
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
    const muted = style.getPropertyValue("--muted").trim() || "#a3adbb";
    const chartColor = style.getPropertyValue("--chart-color").trim() || "#73bdf5";
    const ceiling = Math.max(1, ...series.map(s => s.tokens));
    const left = 36, plot = w - left - 6, base = h - 20;
    const step = plot / series.length;
    ctx.font = "10px -apple-system, sans-serif";
    for (let t = 0; t <= 2; t++) {
        const y = base - t * (base - 8) / 2;
        ctx.fillStyle = muted;
        ctx.fillText(fmtCompact(Math.round(ceiling * t / 2)) || "0", 0, y + 3);
        ctx.fillStyle = "rgba(232,238,244,0.1)";
        ctx.fillRect(left, y, plot, 1);
    }
    const barW = Math.min(20, Math.max(2, step * 0.62));
    const labelEvery = Math.max(1, Math.ceil(series.length / 5));
    series.forEach((pt, i) => {
        const cx = left + step * (i + 0.5);
        const bh = (base - 8) * pt.tokens / ceiling;
        ctx.fillStyle = chartColor;
        ctx.beginPath();
        ctx.roundRect(cx - barW / 2, base - bh, barW, Math.max(bh, pt.tokens > 0 ? 2 : 0), [3, 3, 0, 0]);
        ctx.fill();
        if (i % labelEvery === 0 || i === series.length - 1) {
            ctx.fillStyle = muted;
            const txt = pt.label.slice(5);
            ctx.fillText(txt, cx - ctx.measureText(txt).width / 2, h - 4);
        }
    });
}

function renderDevices() {
    const net = state.pairing;
    const sk = state.skills || {};
    const namespaces = Object.values(sk.namespaces || {});
    const isCenter = net.mode === "center";
    const isEndpoint = net.mode === "endpoint";
    const hubTone = (isCenter && !net.online) || (isEndpoint && (!net.online || net.endpoint?.status !== "connected")) ? "pending" : "live";
    const hubTitle = isEndpoint ? (net.endpoint?.name || net.endpoint?.address || "中心点") : state.deviceName;
    const hubSub = isCenter ? `中心点 · 端口 ${net.port}` : isEndpoint ? `地址 ${net.endpoint?.address}` : "本机设备 · 单机模式";
    const hubBadge = isCenter ? (net.online ? "运行中" : "未启动")
        : isEndpoint ? (net.endpoint?.status === "pending" ? "待确认" : net.online ? "已连接" : "不可达") : "本机";

    let actionHtml = "";
    if (isCenter) {
        const choices = (net.addresses || []).map(addr =>
            `<option value="${escapeHtml(addr)}" ${addr === invitationAddress ? "selected" : ""}>${escapeHtml(addr)}:${net.port}</option>`
        ).join("");
        actionHtml = `
          <div class="row-detail-drawer">
            <div style="display:flex;gap:6px;align-items:center">
              <select id="centerAddress" class="glass-select" style="flex:1;min-width:0" ${choices ? "" : "disabled"}>
                ${choices || "<option>无可用 IPv4</option>"}
              </select>
              <button type="button" class="glass-btn sm primary" data-action="invite" ${choices && net.online ? "" : "disabled"}>复制邀请</button>
            </div>
            <div class="row-actions-inline">
              ${!net.online ? `<button type="button" class="glass-btn sm primary" data-action="enable-center">重试启动</button>` : ""}
              <button type="button" class="glass-btn sm danger" data-action="use-local">停止中心</button>
            </div>
          </div>`;
    } else if (isEndpoint) {
        actionHtml = `
          <div class="row-detail-drawer">
            ${net.endpoint?.status === "pending" ? `<div>核对码：<strong>${escapeHtml(net.endpoint.check)}</strong>（请在中心端点击确认）</div>` : ""}
            <div class="row-actions-inline">
              <button type="button" class="glass-btn sm" data-action="refresh-pairing">刷新连接</button>
              <button type="button" class="glass-btn sm danger" data-action="use-local">退出中心</button>
            </div>
          </div>`;
    } else {
        actionHtml = `
          <div class="row-detail-drawer">
            ${joining ? `<textarea id="invite" class="glass-textarea" placeholder="粘贴中心生成的配对邀请…"></textarea>
              <div class="row-actions-inline">
                <button type="button" class="glass-btn sm primary" data-action="submit-invite">提交配对</button>
                <button type="button" class="glass-btn sm" data-action="cancel-join">取消</button>
              </div>` : `
              <div class="row-actions-inline">
                <button type="button" class="glass-btn sm primary" data-action="enable-center">设为中心</button>
                <button type="button" class="glass-btn sm" data-action="show-join">加入中心</button>
              </div>`}
          </div>`;
    }

    const peersHtml = isCenter && net.peers?.length ? `
      <div class="sync-device-rail-list">
        ${net.peers.map(peer => {
            const tone = peer.status === "pending" ? "pending" : peer.online ? "live" : "";
            return `<div class="sync-device-row">
              <span class="sync-device-dot" style="--node-rgb:${tone === "live" ? "var(--success-rgb)" : tone === "pending" ? "244,160,115" : "163,173,187"}"></span>
              <div style="display:grid;gap:4px;min-width:0">
                <div class="row-head">
                  <span class="sync-node-title">${escapeHtml(peer.name)}</span>
                  <span class="sync-node-state">${peer.status === "pending" ? `待确认 ${escapeHtml(peer.check)}` : peer.online ? "在线" : "离线"}</span>
                </div>
                <div class="row-actions-inline">
                  ${peer.status === "pending" ? `<button type="button" class="glass-btn sm primary" data-action="approve" data-id="${escapeHtml(peer.id)}">确认</button>` : ""}
                  <button type="button" class="glass-btn sm danger" data-action="remove" data-id="${escapeHtml(peer.id)}">${peer.status === "pending" ? "拒绝" : "撤销"}</button>
                </div>
              </div>
            </div>`;
        }).join("")}
      </div>` : "";

    const conflictDetails = sk.conflictDetails || [];
    const conflictPanelHtml = conflictDetails.length ? `
      <div class="conflict-panel">
        <div class="row-head">
          <span class="row-title" style="color:var(--orange)">发现 ${conflictDetails.length} 项技能版本冲突</span>
          <button type="button" class="glass-btn sm primary" data-action="resolve-all-conflicts">⚡ 全部按最新对齐</button>
        </div>
        <div class="row-subtitle">不同工具目录存在内容差异；覆盖前会自动备份旧版本至 ~/.qlex-skill-backups</div>
        ${conflictDetails.map(cf => `
          <div class="conflict-item-card">
            <div class="row-head">
              <span class="row-title">${escapeHtml(cf.name)}</span>
              <span class="row-cost">${cf.variants.length} 个目录有差异</span>
            </div>
            <div class="conflict-variants">
              ${cf.variants.map(v => `
                <button type="button" class="conflict-pick-btn ${v.recommended ? "recommended" : ""}" data-resolve-skill="${escapeHtml(cf.name)}:${escapeHtml(v.ns)}" title="以 ${escapeHtml(v.label)} 目录版本为准覆盖其余目录（哈希 ${escapeHtml(v.shortHash)}）">
                  <span>以 ${escapeHtml(v.label)} 为准${v.recommended ? " · 推荐" : ""}</span>
                  <small>${v.filesCount}文件 · ${fmtTime(v.mtimeMs)}</small>
                </button>
              `).join("")}
            </div>
          </div>
        `).join("")}
      </div>
    ` : "";

    const skillsSection = `
      <div class="row">
        <div class="row-head">
          <span class="row-title">本机 Skills 技能同步</span>
          <span class="row-cost">${sk.uniqueSkills ?? 0} 项 · ${conflictDetails.length > 0 ? `冲突 ${conflictDetails.length}` : sk.missingLinks > 0 ? `待对齐 ${sk.missingLinks}` : "已对齐"}</span>
        </div>
        <div class="skills-ns-grid">
          ${namespaces.map(ns => `
            <div class="skill-ns-chip ${ns.enabled ? "enabled" : ""}" data-toggle-ns="${ns.id}" title="${escapeHtml(ns.path)}">
              <span class="skill-ns-left">
                <span class="check-box-svg"><svg viewBox="0 0 12 12"><path d="M2.2 6.2 4.8 8.8 9.8 3.2"/></svg></span>
                <span>${escapeHtml(ns.label)}</span>
              </span>
              <strong>${ns.count}</strong>
            </div>
          `).join("")}
        </div>
        <div class="row-subtitle">${sk.localTime ? `最近本机同步 ${fmtTime(sk.localTime)} · 新增/更新 ${sk.localSynced || 0} · 冲突 ${sk.conflicts || 0}` : "勾选需要保持一致的本机工具目录，一键安全同步（冲突保留并支持备份覆盖）"}</div>
        <div class="row-actions-inline">
          <button type="button" class="glass-btn sm primary" data-action="sync-local-skills">⟳ 立即同步本机 Skills</button>
          <button type="button" class="glass-btn sm" data-action="open-skill-dir" data-ns="agents">打开技能目录 ↗</button>
          <button type="button" class="glass-btn sm" data-action="open-skill-backup-dir">冲突备份 ↗</button>
        </div>
        ${conflictPanelHtml}
      </div>
    `;

    mainListPanel.innerHTML = skillsSection + `
      <div class="sync-map">
        <div class="sync-node ${hubTone}">
          <span class="sync-node-icon">
            <span class="mask-icon" style="-webkit-mask-image:url('icons/devices/${isCenter || isEndpoint ? "server" : "laptop"}.svg');mask-image:url('icons/devices/${isCenter || isEndpoint ? "server" : "laptop"}.svg')"></span>
          </span>
          <div class="sync-node-text">
            <div class="sync-node-title">${escapeHtml(hubTitle)}</div>
            <div class="sync-node-sub">${escapeHtml(hubSub)}</div>
          </div>
          <span class="sync-node-state">${hubBadge}</span>
        </div>
        ${peersHtml}
      </div>
      ${actionHtml}
      <div class="row" style="margin-top:2px">
        <div class="row-head"><span class="row-subtitle">本机设备</span><span class="row-value">${escapeHtml(state.deviceName)}</span></div>
        <div class="row-head"><span class="row-subtitle">系统平台</span><span class="row-value">${state.platform === "darwin" ? "macOS" : state.platform}</span></div>
      </div>
    `;
}

function renderViewSwitcher() {
    const active = VIEWS.find(v => v.id === view) || VIEWS[0];
    viewSwitcherIcon.style.webkitMaskImage = `url('${active.icon}')`;
    viewSwitcherIcon.style.maskImage = `url('${active.icon}')`;
    viewSwitcherLabel.textContent = active.label;
    viewSwitcherMenu.innerHTML = VIEWS.map(v => `
      <button class="view-switcher-menu-item ${v.id === view ? "is-current" : ""}" type="button" role="menuitemradio" data-view="${v.id}">
        <span class="mask-icon" style="width:14px;height:14px;-webkit-mask-image:url('${v.icon}');mask-image:url('${v.icon}')"></span>
        <span>${v.label}</span>
      </button>
    `).join("");
}

function render() {
    if (!state) return;
    window.QlexTheme.applyAppearance(state.appearance);
    if (state.nativeMaterial) window.QlexTheme.applyNativeMaterial(state.nativeMaterial);
    updateLiveDotAndSyncButton();

    shell.classList.toggle("onboarding-open", !state.configured);
    shell.classList.toggle("settings-open", state.configured && settingsOpen);
    settingsButton.classList.toggle("active", settingsOpen);

    const slotMap = { 1: 0, 7: 1, 30: 2, 90: 2 };
    periodTabs.style.setProperty("--period-index", String(slotMap[period] ?? 1));
    for (const tab of periodTabs.querySelectorAll(".tab")) {
        tab.classList.toggle("active", Number(tab.dataset.period) === period);
    }

    for (const el of [onboardingPanel, settingsPanel, totalPanel, viewBackRow, searchHost, homePanel, mainListPanel, limitsPanel, trendsPanel, footer]) {
        el.classList.add("hidden");
    }

    if (!state.configured) {
        onboardingPanel.classList.remove("hidden");
        renderOnboarding();
        return;
    }

    footer.classList.remove("hidden");
    renderViewSwitcher();

    if (settingsOpen) {
        settingsPanel.classList.remove("hidden");
        renderSettings();
        return;
    }

    const report = selectedReport();
    const totalSessions = report ? Object.values(report.totals || {}).reduce((s, x) => s + (x.sessions || 0), 0) : 0;
    totalPanel.classList.remove("hidden");
    totalLabel.textContent = `${PERIODS[period]} TOTAL TOKENS`;
    usageUpdated.textContent = usageNotice();
    animateTotalNumber(report?.total ?? 0);
    totalSubline.textContent = `${fmtNum(totalSessions)} 会话 · ${fmtNum(report?.projects?.length || 0)} 工作区 · ${ROLES[state.pairing.mode]}`;

    const canSearch = view === "projects" || view === "sessions";
    searchToggleBtn.classList.toggle("hidden", !canSearch || Boolean(projectDetail));
    searchToggleBtn.classList.toggle("is-active", searchVisible);

    if (view !== "home") {
        viewBackRow.classList.remove("hidden");
        if (view === "projects" && projectDetail) {
            backButtonLabel.textContent = "返回项目列表";
            viewHeaderActions.innerHTML = "";
        } else if (view === "projects") {
            backButtonLabel.textContent = "返回首页";
            viewHeaderActions.innerHTML = `<button type="button" class="glass-btn sm primary" data-action="add-project">+ 添加项目</button>`;
        } else {
            backButtonLabel.textContent = "返回首页";
            viewHeaderActions.innerHTML = "";
        }
    }

    if (canSearch && searchVisible && !projectDetail) {
        searchHost.classList.remove("hidden");
        searchInput.placeholder = view === "projects" ? "搜索项目名或路径…" : "搜索会话工作区…";
        if (searchInput.value !== projectQuery) searchInput.value = projectQuery;
        if (view === "sessions") {
            sessionSourceFilter.classList.remove("hidden");
            sessionSourceFilter.innerHTML = `<option value="">全部工具</option>` +
                Object.entries(SOURCE_NAMES).map(([k, l]) => `<option value="${k}" ${k === sessionSource ? "selected" : ""}>${l}</option>`).join("");
        } else {
            sessionSourceFilter.classList.add("hidden");
        }
    }

    if (view === "home") {
        homePanel.classList.remove("hidden");
        renderHome();
    } else if (view === "usage") {
        mainListPanel.classList.remove("hidden");
        renderUsageList();
    } else if (view === "limits") {
        limitsPanel.classList.remove("hidden");
        renderLimits();
    } else if (view === "memory") {
        mainListPanel.classList.remove("hidden");
        renderMemoryArchiveView();
    } else if (view === "projects") {
        mainListPanel.classList.remove("hidden");
        renderProjects();
    } else if (view === "sessions") {
        mainListPanel.classList.remove("hidden");
        renderSessions();
    } else if (view === "trends") {
        trendsPanel.classList.remove("hidden");
        renderTrends();
    } else if (view === "devices") {
        mainListPanel.classList.remove("hidden");
        renderDevices();
    }
}

async function runAction(btn, fn, { goToView = null, success = "" } = {}) {
    if (busy) return;
    busy = true;
    if (btn) btn.disabled = true;
    try {
        const next = await fn();
        if (next) state = next;
        if (goToView) { settingsOpen = false; view = goToView; }
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

function toggleViewMenu(force) {
    const isOpen = viewSwitcherMenu.matches(":popover-open");
    const wantOpen = force !== undefined ? force : !isOpen;
    if (wantOpen && !isOpen) {
        viewSwitcherMenu.showPopover();
        viewSwitcher.classList.add("is-open");
    } else if (!wantOpen && isOpen) {
        viewSwitcherMenu.hidePopover();
        viewSwitcher.classList.remove("is-open");
    }
}

viewSwitcherCurrent.addEventListener("click", () => toggleViewMenu());
viewSwitcherDisclosure.addEventListener("click", () => toggleViewMenu());
viewSwitcherMenu.addEventListener("toggle", () => {
    viewSwitcher.classList.toggle("is-open", viewSwitcherMenu.matches(":popover-open"));
});

pinButton.addEventListener("click", () => void runAction(pinButton, () => window.qlex.togglePinWindow()));
dashButton.addEventListener("click", () => void window.qlex.openDashboard("activity"));
minButton.addEventListener("click", () => void window.qlex.minimizeWindow());
closeButton.addEventListener("click", () => void window.qlex.closeWindow());
rolePill.addEventListener("click", () => { settingsOpen = false; view = "devices"; render(); });
settingsButton.addEventListener("click", () => { settingsOpen = !settingsOpen; toggleViewMenu(false); render(); });
searchToggleBtn.addEventListener("click", () => {
    searchVisible = !searchVisible;
    render();
    if (searchVisible) searchInput.focus();
});

syncStatusBtn.addEventListener("click", () => {
    void runAction(syncStatusBtn, () => window.qlex.syncNow(), { success: "同步与归档完成" });
});

backButton.addEventListener("click", () => {
    if (view === "projects" && projectDetail) {
        projectDetail = "";
    } else if (view === "memory" && memoryPreview) {
        memoryPreview = null;
    } else {
        view = "home";
        searchVisible = false;
    }
    render();
});

document.addEventListener("click", (event) => {
    const target = event.target;

    if (viewSwitcherMenu.matches(":popover-open") && !viewSwitcher.contains(target) && !viewSwitcherMenu.contains(target)) {
        toggleViewMenu(false);
    }

    const menuView = target.closest("[data-view]");
    if (menuView) {
        view = menuView.dataset.view;
        settingsOpen = false;
        projectDetail = "";
        memoryPreview = null;
        sessionSource = "";
        sessionProject = "";
        toggleViewMenu(false);
        render();
        return;
    }

    const periodBtn = target.closest("[data-period]");
    if (periodBtn && state) {
        const next = Number(periodBtn.dataset.period);
        // #05 Gooey Tab Bar horizontal stretch pulse
        periodTabs.classList.remove("is-stretching");
        void periodTabs.offsetWidth;
        periodTabs.classList.add("is-stretching");
        clearTimeout(stretchTimer);
        stretchTimer = setTimeout(() => periodTabs.classList.remove("is-stretching"), 320);
        if (next <= 7 || state.usage?.history?.[next]) {
            period = next;
            render();
        } else {
            void runAction(periodBtn, async () => {
                const res = await window.qlex.usagePeriod(next);
                period = next;
                return res;
            });
        }
        return;
    }

    const secBtn = target.closest("[data-settings-section]");
    if (secBtn) {
        const id = secBtn.dataset.settingsSection;
        openSettingsSection = openSettingsSection === id ? "" : id;
        renderSettings();
        return;
    }

    const presetBtn = target.closest("[data-theme-preset]");
    if (presetBtn) {
        void runAction(presetBtn, () => window.qlex.updateAppearance({ themePreset: presetBtn.dataset.themePreset }));
        return;
    }

    const memCatBtn = target.closest("[data-mem-cat]");
    if (memCatBtn) {
        memoryCategory = memCatBtn.dataset.memCat;
        memoryPreview = null;
        renderMemoryArchiveView();
        return;
    }

    const memLevelBtn = target.closest("[data-mem-level]");
    if (memLevelBtn) {
        memoryRecallLevel = memLevelBtn.dataset.memLevel;
        if (memoryRecallResult) {
            void window.qlex.memoryRecall({ query: memoryRecallQuery, level: memoryRecallLevel, limit: 10 }).then(res => {
                memoryRecallResult = res;
                renderMemoryArchiveView();
            });
        } else {
            renderMemoryArchiveView();
        }
        return;
    }

    const browseUriEl = target.closest("[data-browse-uri]");
    if (browseUriEl) {
        const uri = browseUriEl.dataset.browseUri;
        void window.qlex.memoryBrowse({ uri, level: "L2" }).then(res => {
            memoryPreview = { kind: "items", key: res.item?.title || uri, uri: res.uri, content: res.content };
            renderMemoryArchiveView();
        }).catch(() => notify("无法读取该记忆详情"));
        return;
    }

    const readMem = target.closest("[data-read-memory]");
    if (readMem) {
        const [kind, ...rest] = readMem.dataset.readMemory.split(":");
        const key = rest.join(":");
        void window.qlex.readMemoryArchive(kind, key).then(entry => {
            memoryPreview = entry;
            renderMemoryArchiveView();
        }).catch(() => notify("无法读取该归档文件"));
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

    const resolveBtn = target.closest("[data-resolve-skill]");
    if (resolveBtn && state) {
        const [name, sourceNs] = resolveBtn.dataset.resolveSkill.split(":");
        void runAction(resolveBtn, async () => {
            const res = await window.qlex.resolveSkillConflict(name, sourceNs);
            const r = res.result || {};
            notify(`已以 ${sourceNs} 为准对齐「${name}」（更新 ${r.updated || 0} 目录，备份 ${r.backedUp || 0} 份旧版）`);
            return res.state;
        });
        return;
    }

    const btn = target.closest("[data-action]");
    if (btn && state) {
        const action = btn.dataset.action;
        if (action === "continue") {
            const mode = document.querySelector('input[name="mode"]:checked')?.value || "local";
            if (mode === "center") void runAction(btn, () => window.qlex.enableCenter(), { goToView: "devices" });
            else if (mode === "endpoint") {
                const code = document.querySelector("#invite")?.value || "";
                void runAction(btn, () => window.qlex.joinCenter(code), { goToView: "devices" });
            } else void runAction(btn, () => window.qlex.configureLocal(), { goToView: "home" });
        } else if (action === "sync-local-skills") {
            void runAction(btn, () => window.qlex.syncLocalSkills(), { success: "本机 Skills 同步完成" });
        } else if (action === "resolve-all-conflicts") {
            void runAction(btn, async () => {
                const res = await window.qlex.resolveAllSkillConflicts("latest");
                const r = res.result || {};
                notify(`已解决 ${r.resolvedCount || 0} 项冲突（对齐 ${r.updatedDirs || 0} 个目录，旧版已备份）`);
                return res.state;
            });
        } else if (action === "open-skill-backup-dir") {
            void window.qlex.openSkillBackupDir();
        } else if (action === "open-skill-dir") {
            void window.qlex.openSkillDir(btn.dataset.ns || "agents");
        } else if (action === "compress-memory") {
            void runAction(btn, () => window.qlex.compressMemory(), { success: "记忆已压缩归档并更新知识图谱" });
        } else if (action === "reflect-memory") {
            void runAction(btn, async () => {
                const res = await window.qlex.memoryReflect({});
                notify(`Hindsight 反思完成：生成/更新 ${res.result?.generated || 0} 条洞察`);
                return res.state;
            });
        } else if (action === "install-memory-skill") {
            void runAction(btn, async () => {
                const res = await window.qlex.installMemorySkill();
                const st = res.result?.status;
                notify(`已将 qlex-memory 检索技能部署到 ${st?.installedCount || 0}/${st?.totalCount || 6} 个 Agent 目录`);
                return res.state;
            });
        } else if (action === "toggle-retain-form") {
            memoryRetainOpen = !memoryRetainOpen;
            renderMemoryArchiveView();
            if (memoryRetainOpen) document.querySelector("#retainContentInput")?.focus();
        } else if (action === "open-memory-dir") {
            void window.qlex.openMemoryDir();
        } else if (action === "choose-memory-dir") {
            void runAction(btn, () => window.qlex.chooseMemoryDir(), { success: "记忆归档目录已更新" });
        } else if (action === "open-memory-file") {
            void window.qlex.openMemoryFile(btn.dataset.kind, btn.dataset.key);
        } else if (action === "close-memory-preview") {
            memoryPreview = null;
            renderMemoryArchiveView();
        } else if (action === "open-dashboard") {
            void window.qlex.openDashboard("activity");
        } else if (action === "open-dashboard-trends") {
            void window.qlex.openDashboard("trends");
        } else if (action === "add-project") {
            void runAction(btn, () => window.qlex.chooseProject());
        } else if (action === "add-discovered-project") {
            void runAction(btn, () => window.qlex.addDiscoveredProject(btn.dataset.directory), { success: "已登记到本机项目" });
        } else if (action === "open-discovered-project") {
            void runAction(btn, () => window.qlex.openDiscoveredProject(btn.dataset.directory));
        } else if (action === "open-project") {
            void runAction(btn, () => window.qlex.openProject(btn.dataset.id));
        } else if (action === "rename-project") {
            editingProject = btn.dataset.id;
            renderProjects();
            document.querySelector("#projectRenameInput")?.focus();
        } else if (action === "cancel-rename") {
            editingProject = "";
            renderProjects();
        } else if (action === "remove-project") {
            void runAction(btn, () => window.qlex.removeProject(btn.dataset.id));
        } else if (action === "more-sessions") {
            sessionLimit += 80;
            renderSessions();
        } else if (action === "enable-center") {
            void runAction(btn, () => window.qlex.enableCenter());
        } else if (action === "show-join") {
            joining = true;
            renderDevices();
            document.querySelector("#invite")?.focus();
        } else if (action === "cancel-join") {
            joining = false;
            renderDevices();
        } else if (action === "submit-invite") {
            const code = document.querySelector("#invite")?.value || "";
            void runAction(btn, () => window.qlex.joinCenter(code));
        } else if (action === "use-local") {
            void runAction(btn, () => window.qlex.useLocal());
        } else if (action === "invite") {
            invitationAddress = document.querySelector("#centerAddress")?.value || "";
            void runAction(btn, () => window.qlex.createInvite(invitationAddress), { success: "配对邀请已复制到剪贴板" });
        } else if (action === "approve") {
            void runAction(btn, () => window.qlex.approveDevice(btn.dataset.id));
        } else if (action === "remove") {
            void runAction(btn, () => window.qlex.removeDevice(btn.dataset.id));
        } else if (action === "refresh-pairing") {
            void runAction(btn, () => window.qlex.refreshPairing());
        }
        return;
    }

    const jumpView = target.closest("[data-jump-view]");
    if (jumpView) {
        view = jumpView.dataset.jumpView;
        settingsOpen = false;
        projectDetail = "";
        memoryPreview = null;
        render();
        return;
    }

    const jumpTool = target.closest("[data-jump-tool]");
    if (jumpTool) {
        expandedSource = jumpTool.dataset.jumpTool;
        view = "usage";
        render();
        return;
    }

    const toggleSrc = target.closest("[data-toggle-source]");
    if (toggleSrc && !target.closest("button")) {
        const src = toggleSrc.dataset.toggleSource;
        expandedSource = expandedSource === src ? "" : src;
        renderUsageList();
        return;
    }

    const sessSrc = target.closest("[data-session-source]");
    if (sessSrc) {
        sessionSource = sessSrc.dataset.sessionSource;
        sessionProject = "";
        searchVisible = true;
        view = "sessions";
        render();
        return;
    }

    const projDetailEl = target.closest("[data-project-detail]");
    if (projDetailEl && !target.closest("button[data-action]")) {
        projectDetail = projDetailEl.dataset.projectDetail;
        view = "projects";
        render();
        return;
    }

    const projSess = target.closest("[data-project-sessions]");
    if (projSess) {
        sessionProject = projSess.dataset.projectSessions;
        sessionSource = "";
        view = "sessions";
        render();
        return;
    }
});

document.addEventListener("change", (event) => {
    const el = event.target;
    if (el.name === "mode") {
        const box = document.querySelector("#onboardingInviteBox");
        if (box) box.classList.toggle("hidden", el.value !== "endpoint");
        if (el.value === "endpoint") document.querySelector("#invite")?.focus();
    } else if (el.id === "systemGlassInput") {
        void runAction(el, () => window.qlex.updateAppearance({ systemGlass: el.checked }));
    } else if (el.id === "macBackdropSelect") {
        void runAction(el, () => window.qlex.updateAppearance({ macBackdrop: el.value }));
    } else if (el.id === "edgeDockSelect") {
        void runAction(el, () => window.qlex.setEdgeDock(el.value));
    } else if (el.id === "edgeDockModeSelect") {
        void runAction(el, () => window.qlex.setEdgeDockMode(el.value));
    } else if (el.id === "alwaysOnTopInput") {
        void runAction(el, () => window.qlex.updateAppearance({ alwaysOnTop: el.checked }));
    } else if (el.id === "keepRunningInput") {
        void runAction(el, () => window.qlex.setKeepRunning(el.checked));
    } else if (el.id === "skillSyncInput") {
        void runAction(el, () => window.qlex.setSkillSync(el.checked));
    } else if (el.id === "memoryAutoInput") {
        void runAction(el, () => window.qlex.setMemoryAutoCompress(el.checked));
    } else if (el.id === "sessionSourceFilter") {
        sessionSource = el.value;
        sessionLimit = 80;
        renderSessions();
    } else if (el.id === "centerAddress") {
        invitationAddress = el.value;
    }
});

document.addEventListener("input", (event) => {
    const el = event.target;
    if (el.id === "searchInput") {
        projectQuery = el.value;
        if (view === "projects") renderProjects();
        else if (view === "sessions") renderSessions();
    } else if (el.id === "glassOpacityRange") {
        const val = Number(el.value);
        const lbl = document.querySelector("#opacityValueLabel");
        if (lbl) lbl.textContent = `${val}%`;
        window.QlexTheme.applyAppearance({ ...state.appearance, glassOpacity: val });
        void window.qlex.updateAppearance({ glassOpacity: val }).then(next => { state = next; });
    } else if (el.id === "glassTintRange") {
        const val = Number(el.value);
        const lbl = document.querySelector("#tintValueLabel");
        if (lbl) lbl.textContent = `${val}%`;
        const key = state.appearance?.macBackdrop === "liquid-glass-clear" ? "macClearGlassTint" : "macGlassTint";
        void window.qlex.updateAppearance({ [key]: val }).then(next => { state = next; });
    }
});

document.addEventListener("submit", (event) => {
    const form = event.target;
    if (form.id === "memoryRecallForm") {
        event.preventDefault();
        memoryRecallQuery = document.querySelector("#memoryRecallInput")?.value?.trim() || "";
        void window.qlex.memoryRecall({ query: memoryRecallQuery, level: memoryRecallLevel, limit: 10 }).then(res => {
            memoryRecallResult = res;
            renderMemoryArchiveView();
        }).catch(() => notify("记忆检索失败"));
        return;
    }
    if (form.id === "memoryRetainForm") {
        event.preventDefault();
        const content = document.querySelector("#retainContentInput")?.value?.trim() || "";
        if (!content) return;
        const title = document.querySelector("#retainTitleInput")?.value?.trim() || undefined;
        const bank = document.querySelector("#retainBankSelect")?.value || undefined;
        const project = document.querySelector("#retainProjectInput")?.value?.trim() || undefined;
        const factKey = document.querySelector("#retainFactKeyInput")?.value?.trim() || undefined;
        void runAction(form.querySelector('[type="submit"]'), async () => {
            const res = await window.qlex.memoryRetain({ content, title, bank, project, factKey, source: "user" });
            memoryRetainOpen = false;
            const op = res.result?.operation || "ADD";
            const gd = res.result?.graphDelta || {};
            notify(`[${op}] 已沉淀记忆 · 图谱 +${gd.entitiesAdded || 0}实体/+${gd.edgesAdded || 0}边`);
            return res.state;
        });
        return;
    }
    if (!form.matches(".project-rename")) return;
    event.preventDefault();
    const val = form.querySelector("#projectRenameInput")?.value || "";
    void runAction(form.querySelector('[type="submit"]'), async () => {
        const next = await window.qlex.renameProject(form.dataset.id, val);
        editingProject = "";
        return next;
    }, { success: "项目名称已更新" });
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        if (viewSwitcherMenu.matches(":popover-open")) toggleViewMenu(false);
        else if (settingsOpen) { settingsOpen = false; render(); }
        else if (memoryPreview) { memoryPreview = null; renderMemoryArchiveView(); }
    }
});

window.qlex.onNativeMaterial?.((mat) => {
    if (state) state.nativeMaterial = mat;
    window.QlexTheme.applyNativeMaterial(mat);
});

window.qlex.onStateChanged?.((next) => {
    const activeId = document.activeElement?.id || "";
    const editingInput = ["searchInput", "invite", "memoryRecallInput", "retainTitleInput", "retainContentInput", "retainProjectInput", "retainFactKeyInput"].includes(activeId);
    if (!busy && !editingProject && !editingInput && !memoryRetainOpen) {
        state = next;
        render();
    }
});

function openFromDock(destination) {
    if (!state) { pendingDestination = destination; return; }
    if (!state.configured) { render(); return; }
    pendingDestination = null;
    settingsOpen = false;
    memoryPreview = null;
    const map = { overview: "home", home: "home", usage: "usage", quota: "limits", limits: "limits", memory: "memory", projects: "projects", sessions: "sessions", devices: "devices", trends: "trends" };
    view = map[destination] || "home";
    period = destination === "sessions" ? 7 : 1;
    render();
}

window.qlex.onNavigate?.(openFromDock);
window.addEventListener("resize", () => { if (view === "trends") paintTrendCanvas(); });

setInterval(async () => {
    if (!state?.configured || state.pairing.mode === "local" || view !== "devices" || busy || refreshing || document.hidden) return;
    refreshing = true;
    try {
        const next = await window.qlex.refreshPairing();
        if (!busy && view === "devices" && JSON.stringify(state.pairing) !== JSON.stringify(next.pairing)) {
            state = next;
            render();
        }
    } catch { /* retry next tick */ }
    finally { refreshing = false; }
}, 4000);

(async () => {
    try {
        state = await window.qlex.getState();
        const mat = await window.qlex.getNativeMaterial();
        if (mat) state.nativeMaterial = mat;
        if (pendingDestination) openFromDock(pendingDestination);
        else render();
    } catch {
        notify("无法读取 QLEX 本机状态，请重新打开应用。", 0);
    }
})();
