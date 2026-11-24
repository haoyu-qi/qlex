"use strict";

const healthIcon = document.querySelector("#healthIcon");
const healthScore = document.querySelector("#healthScore");
const healthLabel = document.querySelector("#healthLabel");
const mbMetaPills = document.querySelector("#mbMetaPills");
const mbBentoGrid = document.querySelector("#mbBentoGrid");
const mbRingsCard = document.querySelector("#mbRingsCard");
const mbListCard = document.querySelector("#mbListCard");
const mbFooterCard = document.querySelector("#mbFooterCard");
const mbSyncTopBtn = document.querySelector("#mbSyncTopBtn");
const mbOpenMainBtn = document.querySelector("#mbOpenMainBtn");

const ROLES = { local: "单机模式", center: "中心点", endpoint: "接入点" };
let state = null;
let busy = false;
let lastAppearanceFp = "";
let lastMaterialFp = "";
const lastCountValues = new Map();
let revealPulse = false;

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtNum = (v) => new Intl.NumberFormat("zh-CN").format(Math.round(v || 0));
const fmtShortTime = (ts) => ts ? new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "待同步";

function animateCounters(forceRoll = false) {
    const nodes = document.querySelectorAll("[data-count-key]");
    for (const el of nodes) {
        const key = el.dataset.countKey;
        const target = Number(el.dataset.countTo || 0);
        const suffix = el.dataset.countSuffix || "";
        const format = el.dataset.countFmt !== "raw";
        const prev = lastCountValues.has(key) ? lastCountValues.get(key) : (forceRoll ? Math.round(target * 0.65) : target);
        const startVal = forceRoll ? Math.max(0, Math.round(target * 0.55)) : prev;
        lastCountValues.set(key, target);

        if (startVal === target) {
            el.textContent = (format ? fmtNum(target) : String(Math.round(target))) + suffix;
            continue;
        }
        const duration = 520;
        const t0 = performance.now();
        const step = (now) => {
            const p = Math.min(1, (now - t0) / duration);
            const eased = 1 - Math.pow(1 - p, 3);
            const cur = Math.round(startVal + (target - startVal) * eased);
            el.textContent = (format ? fmtNum(cur) : String(cur)) + suffix;
            if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }
}

function triggerRevealAnimation() {
    const shell = document.querySelector("#mbShell");
    if (!shell) return;
    shell.classList.remove("mb-reveal");
    void shell.offsetWidth;
    shell.classList.add("mb-reveal");
    revealPulse = true;
    animateCounters(true);
    // Smoothly sweep rings from 0 to target on open
    for (const ring of document.querySelectorAll(".mb-ring circle.fill[data-target-offset]")) {
        const circ = ring.getAttribute("stroke-dasharray");
        const targetOffset = ring.dataset.targetOffset;
        ring.style.transition = "none";
        ring.setAttribute("stroke-dashoffset", circ);
        requestAnimationFrame(() => {
            ring.style.transition = "";
            ring.setAttribute("stroke-dashoffset", targetOffset);
        });
    }
    setTimeout(() => { revealPulse = false; }, 600);
}

function patchHtml(el, html) {
    if (!el || el.__mbHtml === html) return;
    el.__mbHtml = html;
    el.innerHTML = html;
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
    const label = phase === "syncing" ? "同步中"
        : score >= 94 ? "很好"
        : score >= 82 ? "良好"
        : sk.conflicts > 0 ? "存在冲突" : "待检查";
    return { score, phase, label };
}

function ringSvg(pct, label, tone = "") {
    const r = 14;
    const circ = 2 * Math.PI * r;
    const clamped = Math.max(0, Math.min(100, pct));
    const offset = circ * (1 - clamped / 100);
    return `
      <div class="mb-ring" title="${esc(label)} ${clamped}%">
        <svg viewBox="0 0 36 36">
          <circle class="track" cx="18" cy="18" r="${r}" />
          <circle class="fill ${tone}" cx="18" cy="18" r="${r}" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" data-target-offset="${offset.toFixed(1)}" />
        </svg>
        <span class="mb-ring-label">${esc(label)}</span>
      </div>
    `;
}

function render() {
    if (!state) return;
    const appFp = JSON.stringify(state.appearance || {});
    if (appFp !== lastAppearanceFp) {
        lastAppearanceFp = appFp;
        window.QlexTheme?.applyAppearance(state.appearance);
    }
    const matFp = JSON.stringify(state.nativeMaterial || {});
    if (state.nativeMaterial && matFp !== lastMaterialFp) {
        lastMaterialFp = matFp;
        window.QlexTheme?.applyNativeMaterial(state.nativeMaterial);
    }

    const net = state.pairing || { mode: "local", peers: [] };
    const ts = state.tailscale || {};
    const sk = state.skills || {};
    const mem = state.memoryArchive || {};
    const cog = mem.cognitive || { activeItems: 0, entities: 0, activeEdges: 0, reflectionsCount: 0 };
    const counts = mem.counts || { daily: 0, weekly: 0, monthly: 0 };
    const ms = state.memorySkill || { installedCount: 0, totalCount: 6 };
    const syncSt = state.syncStatus || { phase: "idle", label: "待同步", time: 0 };
    const boundProjects = state.projects || [];
    const remoteProjects = state.remoteProjects || [];
    const upd = state.updater || {};

    const health = computeHealth(state);
    healthIcon.className = `mb-health-icon ${health.phase}`;
    healthScore.dataset.countKey = "health";
    healthScore.dataset.countTo = String(health.score);
    healthScore.dataset.countFmt = "raw";
    healthScore.textContent = String(health.score);
    healthLabel.textContent = health.label;
    mbSyncTopBtn.disabled = syncSt.phase === "syncing" || busy;
    mbSyncTopBtn.textContent = syncSt.phase === "syncing" ? "⟳ 同步中" : "⟳ 同步";

    const pills = [
        { text: ROLES[net.mode] || "单机", flex: false },
        { text: (state.deviceName || "macOS").replace(/\.local$/i, ""), flex: true },
        { text: ts.online && ts.self?.ip ? ts.self.ip : "局域网", flex: false },
        { text: `v${state.version || "0.2.2"}`, flex: false },
    ];
    patchHtml(mbMetaPills, pills.map(p => `<span class="mb-meta-pill${p.flex ? " flex" : ""}" title="${esc(p.text)}">${esc(p.text)}</span>`).join(""));

    // 1. 状态卡片（中心点/接入点）
    const connectedPeers = (net.peers || []).filter(p => p.status === "connected").length;
    const onlinePeers = (net.peers || []).filter(p => p.online).length;
    const pendingPeers = (net.peers || []).filter(p => p.status === "pending").length;
    const nodeTagClass = net.mode === "local" ? "" : net.online ? "ok" : "warn";
    const nodeTagText = net.mode === "center" ? (net.online ? "运行中" : "未启动")
        : net.mode === "endpoint" ? (net.online ? "已连接" : "离线") : "单机";
    const nodeMetric = net.mode === "center" ? `${onlinePeers}<small>/${connectedPeers} 节点</small>`
        : net.mode === "endpoint" ? (net.online ? "在线" : "离线") : "本机";
    const nodeSub = net.mode === "center" ? `端口 ${net.port} · ${pendingPeers} 待确认`
        : net.mode === "endpoint" ? `${net.endpoint?.name || net.endpoint?.address || "中心节点"}`
        : "可随时设为中心或接入";
    const eqLit = net.mode === "local" ? 5 : net.online ? 9 : 2;
    const eqBars = Array.from({ length: 10 }, (_, i) => `<span class="mb-eq-bar ${i < eqLit ? (net.online || net.mode === "local" ? "on" : "warn") : ""}" style="--eq-i:${i}"></span>`).join("");

    // 2. 同步状态卡片
    const syncTagClass = syncSt.phase === "synced" ? "ok" : syncSt.phase === "syncing" ? "blue" : syncSt.phase === "error" ? "err" : "warn";
    const syncTimeText = fmtShortTime(syncSt.time);
    const syncMetricText = syncSt.phase === "syncing" ? "同步中" : syncSt.phase === "synced" ? "正常" : syncSt.phase === "conflict" ? `冲突 ${sk.conflicts}` : "待同步";

    // 3. 记忆状态卡片
    const memRatio = Math.max(8, Math.min(100, mem.compressionRatio || 0));

    // 4. 项目同步卡片
    const totalProj = boundProjects.length + remoteProjects.length;
    const boundPct = totalProj > 0 ? Math.round((boundProjects.length / totalProj) * 100) : 0;

    // 5. Tailscale 穿透卡片
    const tsTagClass = ts.online ? "ok" : "warn";
    const tsTagText = ts.mode === "embedded" && ts.online ? "tsnet" : ts.online ? "已穿透" : "未连接";
    const tsMetric = ts.online ? `<span data-count-key="tsCenters" data-count-to="${(ts.discoveredCenters || []).length}" data-count-fmt="raw">${(ts.discoveredCenters || []).length}</span><small> 台中心</small>` : "离线";
    const tsSub = ts.online ? (ts.self?.dnsName || ts.self?.ip || "Tailnet 在线") : "支持一键启动内嵌 tsnet";

    // 6. Skills 同步卡片
    const skTagClass = sk.conflicts > 0 ? "warn" : sk.missingLinks > 0 ? "blue" : "ok";
    const skTagText = sk.conflicts > 0 ? `冲突 ${sk.conflicts}` : sk.missingLinks > 0 ? `待齐 ${sk.missingLinks}` : "已对齐";

    const syncSpeed = syncSt.phase === "syncing" ? "1.3s" : "3.6s";
    patchHtml(mbBentoGrid, `
      <div class="mb-card" data-open-page="devices">
        <div class="mb-card-head">
          <span class="mb-card-title"><i class="dot live" style="background:var(--success)"></i>节点状态</span>
          <span class="mb-tag ${nodeTagClass}">${nodeTagText}</span>
        </div>
        <div class="mb-card-metric">${nodeMetric}</div>
        <div class="mb-eq-bars">${eqBars}</div>
        <div class="mb-card-sub">${esc(nodeSub)}</div>
      </div>

      <div class="mb-card" data-action="sync-now">
        <div class="mb-card-head">
          <span class="mb-card-title"><i class="dot live" style="background:var(--orange)"></i>双向同步</span>
          <span class="mb-tag ${syncTagClass}">${esc(syncTimeText)}</span>
        </div>
        <div class="mb-card-metric">${esc(syncMetricText)}</div>
        <svg class="mb-spark-svg" viewBox="0 0 120 20" preserveAspectRatio="none">
          <path id="mbSyncWavePath" d="M0 14 L20 13 L35 11 L52 13 L68 9 L86 12 L102 7 L120 9" fill="none" stroke="rgba(244,160,115,0.34)" stroke-width="1.6" stroke-linecap="round"/>
          <path class="mb-spark-flow" d="M0 14 L20 13 L35 11 L52 13 L68 9 L86 12 L102 7 L120 9" fill="none" stroke="var(--orange)" stroke-width="1.9" stroke-linecap="round"/>
          <circle r="2.6" fill="var(--orange)">
            <animateMotion dur="${syncSpeed}" repeatCount="indefinite" path="M0 14 L20 13 L35 11 L52 13 L68 9 L86 12 L102 7 L120 9"/>
          </circle>
        </svg>
        <div class="mb-card-sub">点击立即同步记忆 · 项目 · 技能</div>
      </div>

      <div class="mb-card" data-open-page="memory">
        <div class="mb-card-head">
          <span class="mb-card-title"><i class="dot live" style="background:var(--purple)"></i>记忆同步</span>
          <span class="mb-tag">压缩 ${mem.compressionRatio ?? 0}%</span>
        </div>
        <div class="mb-card-metric"><span data-count-key="memActive" data-count-to="${cog.activeItems || 0}">${fmtNum(cog.activeItems || 0)}</span><small>条</small></div>
        <div class="mb-prog-track"><div class="mb-prog-fill gold" style="width:${memRatio}%"></div></div>
        <div class="mb-card-sub">${cog.entities || 0} 实体 · ${cog.activeEdges || 0} 边 · 日${counts.daily}/周${counts.weekly}/月${counts.monthly}</div>
      </div>

      <div class="mb-card" data-open-page="projects">
        <div class="mb-card-head">
          <span class="mb-card-title"><i class="dot live" style="background:var(--blue)"></i>项目同步</span>
          <span class="mb-tag ${remoteProjects.length ? "warn" : "ok"}">${remoteProjects.length ? `${remoteProjects.length} 待绑定` : "已对齐"}</span>
        </div>
        <div class="mb-card-metric"><span data-count-key="projBound" data-count-to="${boundProjects.length}" data-count-fmt="raw">${boundProjects.length}</span><small>/${totalProj} 项目</small></div>
        <div class="mb-prog-track"><div class="mb-prog-fill blue" style="width:${boundPct}%"></div></div>
        <div class="mb-card-sub">${remoteProjects.length ? `有 ${remoteProjects.length} 个跨端共享项目待绑定` : `${boundProjects.reduce((s, p) => s + (p.fileCount || 0), 0)} 个工作区文件已对齐`}</div>
      </div>

      <div class="mb-card" data-action="tailscale-scan">
        <div class="mb-card-head">
          <span class="mb-card-title"><i class="dot live" style="background:var(--accent)"></i>内网穿透</span>
          <span class="mb-tag ${tsTagClass}">${tsTagText}</span>
        </div>
        <div class="mb-card-metric">${tsMetric}</div>
        <svg class="mb-spark-svg" viewBox="0 0 120 20" preserveAspectRatio="none">
          <path d="M0 15 Q 25 14, 45 11 T 78 6 T 120 12" fill="none" stroke="rgba(183,234,212,0.34)" stroke-width="1.6"/>
          <path class="mb-spark-flow" d="M0 15 Q 25 14, 45 11 T 78 6 T 120 12" fill="none" stroke="var(--accent)" stroke-width="1.9"/>
          <path d="M0 16 Q 30 15, 60 12 T 120 15" fill="none" stroke="var(--blue)" stroke-width="1.2" opacity="0.65"/>
          <circle r="2.6" fill="var(--accent)">
            <animateMotion dur="4.2s" repeatCount="indefinite" path="M0 15 Q 25 14, 45 11 T 78 6 T 120 12"/>
          </circle>
        </svg>
        <div class="mb-card-sub">${esc(tsSub)}</div>
      </div>

      <div class="mb-card" data-open-page="projects">
        <div class="mb-card-head">
          <span class="mb-card-title"><i class="dot live" style="background:var(--success)"></i>Skills 同步</span>
          <span class="mb-tag ${skTagClass}">${skTagText}</span>
        </div>
        <div class="mb-card-metric"><span data-count-key="skCount" data-count-to="${sk.uniqueSkills ?? 0}">${sk.uniqueSkills ?? 0}</span><small>项</small></div>
        <div class="mb-seg-actions">
          <button type="button" class="mb-seg-btn active" data-action="sync-skills">对齐</button>
          <button type="button" class="mb-seg-btn ${sk.conflicts > 0 ? "warn" : ""}" data-action="resolve-conflicts">${sk.conflicts > 0 ? `解冲突` : "无冲突"}</button>
          <button type="button" class="mb-seg-btn" data-action="install-mem-skill">部署</button>
        </div>
      </div>
    `);

    // Wide Ring Card (Agent 技能 + 对齐度 + 网络状态)
    const agentPct = ms.totalCount ? Math.round(((ms.installedCount || 0) / ms.totalCount) * 100) : 100;
    const skillsAlignedPct = sk.conflicts > 0 ? Math.max(20, 100 - sk.conflicts * 15) : sk.missingLinks > 0 ? 80 : 100;
    const netPct = ts.online ? 100 : net.online ? 85 : 50;
    patchHtml(mbRingsCard, `
      <div class="mb-card-head">
        <span class="mb-card-title"><i class="dot live" style="background:var(--success)"></i>跨 Agent 检索技能 · qlex-memory</span>
        <span class="mb-tag ${agentPct === 100 ? "ok" : "warn"}">部署 ${ms.installedCount || 0}/${ms.totalCount || 9}</span>
      </div>
      <div class="mb-rings-body">
        <div class="mb-rings-info">
          <div class="mb-card-metric"><span data-count-key="agentPct" data-count-to="${agentPct}" data-count-suffix="%" data-count-fmt="raw">${agentPct}%</span><small style="margin-left:5px">${ms.installedCount || 0} 工具就绪</small></div>
          <div class="mb-card-sub" title="Codex · Claude · Hermes · Antigravity · DSH · WorkBuddy · ZCode · T3 Code">Codex · Claude · Hermes · WorkBuddy · ZCode · T3</div>
        </div>
        <div class="mb-rings-group">
          ${ringSvg(agentPct, "技能", agentPct === 100 ? "" : "warn")}
          ${ringSvg(skillsAlignedPct, "对齐", skillsAlignedPct === 100 ? "" : "warn")}
          ${ringSvg(netPct, "穿透", ts.online ? "" : "blue")}
        </div>
      </div>
    `);

    // Active Projects & Remote Shared Projects / Peers Table
    const rows = [
        ...remoteProjects.slice(0, 2).map(rp => ({
            name: rp.name,
            col1: rp.fileCount ? `${rp.fileCount} 文件` : "远端共享",
            col1Cls: "warn",
            col2: "待绑定",
            action: `bind-remote:${rp.syncId}`,
        })),
        ...boundProjects.slice(0, 4).map(p => ({
            name: p.name,
            col1: p.fileCount ? `${p.fileCount} 文件` : "已同步",
            col1Cls: "ok",
            col2: "打开 ↗",
            action: `open-project:${p.id}`,
        })),
    ];
    if (!rows.length && (net.peers || []).length) {
        for (const peer of net.peers.slice(0, 4)) {
            rows.push({
                name: peer.name,
                col1: peer.status === "pending" ? "待确认" : peer.online ? "在线" : "离线",
                col1Cls: peer.online ? "ok" : "warn",
                col2: "管理 ›",
                action: "open-page:devices",
            });
        }
    }

    patchHtml(mbListCard, `
      <div class="mb-table-head">
        <span>同步项目与接入节点</span>
        <span>状态</span>
        <span>操作</span>
      </div>
      ${rows.length ? rows.slice(0, 5).map(r => `
        <div class="mb-table-row" data-row-action="${esc(r.action)}">
          <span class="mb-table-name">${esc(r.name)}</span>
          <span class="mb-table-col ${r.col1Cls}">${esc(r.col1)}</span>
          <span class="mb-table-col">${esc(r.col2)}</span>
        </div>
      `).join("") : `<div class="mb-card-sub" data-open-page="projects" style="padding:3px 0;cursor:pointer">暂未登记跨端项目，点击此处前往添加工作区 ↗</div>`}
    `);

    // Footer Quick Actions + 3 Summary KPIs
    const updNotice = upd.phase === "available" || upd.phase === "ready"
        ? `✦ 新版本 ${upd.latest?.version || ""}`
        : `记忆归档 · ${counts.daily}日/${counts.weekly}周/${counts.monthly}月`;

    patchHtml(mbFooterCard, `
      <div class="mb-footer-top">
        <span>${esc(updNotice)}</span>
        <div class="mb-footer-actions">
          <button type="button" class="mb-link-btn" data-action="compress-memory">⚡ 压缩记忆</button>
          <button type="button" class="mb-link-btn" data-action="open-memory-dir">目录 ↗</button>
        </div>
      </div>
      <div class="mb-footer-kpis">
        <div class="mb-kpi" data-open-page="memory">
          <strong data-count-key="kpiMem" data-count-to="${cog.activeItems || 0}">${fmtNum(cog.activeItems || 0)}</strong>
          <span>活跃记忆</span>
        </div>
        <div class="mb-kpi" data-open-page="projects">
          <strong data-count-key="kpiSk" data-count-to="${sk.uniqueSkills || 0}">${fmtNum(sk.uniqueSkills || 0)}</strong>
          <span>本机技能</span>
        </div>
        <div class="mb-kpi" data-open-page="projects">
          <strong data-count-key="kpiProj" data-count-to="${boundProjects.length}" data-count-fmt="raw">${boundProjects.length}</strong>
          <span>同步项目</span>
        </div>
      </div>
    `);

    if (!revealPulse) animateCounters(false);

    requestAnimationFrame(() => {
        const shell = document.querySelector("#mbShell");
        if (!shell) return;
        const needed = Math.ceil(shell.scrollHeight) + 2;
        if (needed > 300) {
            void window.qlex.resizeMenubarPopover?.(needed);
        }
    });
}

async function runBusy(fn) {
    if (busy) return;
    busy = true;
    try {
        const next = await fn();
        if (next && next.version) state = next;
        else if (next?.state) state = next.state;
        else state = await window.qlex.getState();
        render();
    } finally {
        busy = false;
    }
}

mbSyncTopBtn.addEventListener("click", () => void runBusy(() => window.qlex.syncNow()));
mbOpenMainBtn.addEventListener("click", () => void window.qlex.openMainPage("home"));

document.addEventListener("click", (event) => {
    const actionBtn = event.target.closest("[data-action]");
    if (actionBtn) {
        event.stopPropagation();
        const act = actionBtn.dataset.action;
        if (act === "sync-now") void runBusy(() => window.qlex.syncNow());
        else if (act === "sync-skills") void runBusy(() => window.qlex.syncLocalSkills());
        else if (act === "resolve-conflicts") void runBusy(() => window.qlex.resolveAllSkillConflicts("latest"));
        else if (act === "install-mem-skill") void runBusy(() => window.qlex.installMemorySkill());
        else if (act === "tailscale-scan") void runBusy(() => window.qlex.tailscaleScan());
        else if (act === "compress-memory") void runBusy(() => window.qlex.syncMemoryNow());
        else if (act === "open-memory-dir") void window.qlex.openMemoryDir();
        return;
    }

    const rowEl = event.target.closest("[data-row-action]");
    if (rowEl) {
        const [kind, val] = rowEl.dataset.rowAction.split(":");
        if (kind === "open-project") void window.qlex.openProject(val);
        else if (kind === "bind-remote") void runBusy(() => window.qlex.bindRemoteProject(val));
        else if (kind === "open-page") void window.qlex.openMainPage(val);
        return;
    }

    const pageEl = event.target.closest("[data-open-page]");
    if (pageEl) {
        void window.qlex.openMainPage(pageEl.dataset.openPage);
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") void window.qlex.closeMenubarPopover();
});

window.qlex.onStateChanged?.((next) => {
    if (!busy && next) {
        state = next;
        render();
    }
});

window.qlex.onNativeMaterial?.((mat) => {
    if (state) state.nativeMaterial = mat;
    window.QlexTheme?.applyNativeMaterial(mat);
});

window.qlex.onMenubarShown?.(() => {
    triggerRevealAnimation();
});

(async () => {
    try {
        state = await window.qlex.getState();
        const mat = await window.qlex.getNativeMaterial();
        if (mat) state.nativeMaterial = mat;
        render();
        triggerRevealAnimation();
    } catch { /* ignore */ }
})();
