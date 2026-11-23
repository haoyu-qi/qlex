"use strict";

const activityTab = document.querySelector("#activityTab");
const trendsTab = document.querySelector("#trendsTab");
const activityPane = document.querySelector("#activityPane");
const trendsPane = document.querySelector("#trendsPane");
const rangeGroup = document.querySelector("#rangeGroup");
const dashCards = document.querySelector("#dashCards");
const dashUpdated = document.querySelector("#dashUpdated");
const dashMiniChart = document.querySelector("#dashMiniChart");
const dashBreakdown = document.querySelector("#dashBreakdown");
const dashChart = document.querySelector("#dashChart");
const dashLegend = document.querySelector("#dashLegend");
const dashTooltip = document.querySelector("#dashTooltip");
const flatToggle = document.querySelector("#flatToggle");
const refreshBtn = document.querySelector("#refreshBtn");
const minBtn = document.querySelector("#minBtn");
const closeBtn = document.querySelector("#closeBtn");

const SOURCE_NAMES = {
    antigravity: "Antigravity",
    codex: "Codex",
    claude: "Claude Code",
    hermes: "Hermes",
    dsh: "DSH",
};

let state = null;
let tab = new URLSearchParams(location.search).get("tab") === "trends" ? "trends" : "activity";
let days = 7;

const fmtNum = (v) => v == null ? "—" : new Intl.NumberFormat("zh-CN").format(v);
const fmtCompact = (v) => v == null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const sourceColor = (src) => window.QlexTheme?.SOURCE_COLORS?.[src] || "#73bdf5";

function selectedReport() {
    if (!state?.usage) return null;
    if (days === 1) return state.usage.today;
    if (days === 7) return state.usage.week;
    return state.usage.history?.[days] || state.usage.week;
}

function buildDailySeries() {
    const report = selectedReport();
    const raw = days === 1
        ? (report ? [{ date: new Date().toISOString().slice(0, 10), tokens: report.total }] : [])
        : (report?.daily || []);
    const map = new Map(raw.map(r => [r.date, r.tokens]));
    const end = new Date();
    return Array.from({ length: days }, (_, idx) => {
        const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - idx - 1));
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        return { date: key, tokens: map.get(key) || 0 };
    });
}

function renderSvgBarChart(container, series) {
    const w = Math.max(360, container.clientWidth || 720);
    const h = Math.max(140, container.clientHeight || 180);
    const padL = 44, padR = 14, padT = 12, padB = 24;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const maxVal = Math.max(1, ...series.map(s => s.tokens));
    const step = plotW / Math.max(1, series.length);
    const barW = Math.max(3, Math.min(28, step * 0.62));
    const labelEvery = Math.max(1, Math.ceil(series.length / 8));
    const chartColor = getComputedStyle(document.documentElement).getPropertyValue("--chart-color").trim() || "#73bdf5";

    const gridLines = [0, 0.5, 1].map(frac => {
        const y = padT + plotH * (1 - frac);
        const val = Math.round(maxVal * frac);
        return `<line class="${frac === 0 ? "axis-base" : "grid-line"}" x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" />
          <text class="axis-label" x="${padL - 6}" y="${y + 3}" text-anchor="end">${fmtCompact(val)}</text>`;
    }).join("");

    const bars = series.map((pt, i) => {
        const cx = padL + step * (i + 0.5);
        const bh = (pt.tokens / maxVal) * plotH;
        const y = padT + plotH - bh;
        const showLabel = i % labelEvery === 0 || i === series.length - 1;
        return `<g>
          <rect x="${cx - barW / 2}" y="${y}" width="${barW}" height="${Math.max(bh, pt.tokens > 0 ? 2 : 0)}" rx="3" fill="${chartColor}" opacity="0.88" />
          <rect class="bar-hover" x="${padL + step * i}" y="${padT}" width="${step}" height="${plotH}" data-date="${pt.date}" data-tokens="${pt.tokens}" />
          ${showLabel ? `<text class="axis-label" x="${cx}" y="${h - 6}" text-anchor="middle">${pt.date.slice(5)}</text>` : ""}
        </g>`;
    }).join("");

    container.innerHTML = `<svg class="dash-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${gridLines}${bars}</svg>`;
}

function render() {
    if (!state) return;
    window.QlexTheme.applyAppearance(state.appearance);
    if (state.nativeMaterial) window.QlexTheme.applyNativeMaterial(state.nativeMaterial);
    document.body.classList.toggle("flat", Boolean(state.appearance?.dashboardFlat));
    flatToggle.classList.toggle("active", Boolean(state.appearance?.dashboardFlat));

    activityTab.classList.toggle("active", tab === "activity");
    trendsTab.classList.toggle("active", tab === "trends");
    activityPane.classList.toggle("hidden", tab !== "activity");
    trendsPane.classList.toggle("hidden", tab !== "trends");

    for (const btn of rangeGroup.querySelectorAll(".range-btn")) {
        btn.classList.toggle("active", Number(btn.dataset.days) === days);
    }

    const report = selectedReport();
    const totalTokens = report?.total || 0;
    const totalSessions = report ? Object.values(report.totals || {}).reduce((s, x) => s + (x.sessions || 0), 0) : 0;
    const activeProjects = report?.projects?.length || 0;
    const codexWin = state.usage?.quotas?.codex?.windows?.filter(w => !w.resetsAt || w.resetsAt > Date.now());
    const minRem = codexWin?.length ? `${Math.round(Math.min(...codexWin.map(w => 100 - w.used)))}%` : "—";

    dashCards.innerHTML = `
      <div class="dash-card"><div class="dash-card-v">${fmtNum(totalTokens)}</div><div class="dash-card-k">TOTAL TOKENS</div></div>
      <div class="dash-card"><div class="dash-card-v">${fmtNum(totalSessions)}</div><div class="dash-card-k">会话总数</div></div>
      <div class="dash-card"><div class="dash-card-v">${fmtNum(activeProjects)}</div><div class="dash-card-k">活跃工作区</div></div>
      <div class="dash-card"><div class="dash-card-v">${minRem}</div><div class="dash-card-k">Codex 剩余额度</div></div>
    `;

    dashUpdated.textContent = state.usage?.time ? `更新于 ${new Date(state.usage.time).toLocaleString("zh-CN")}` : "正在采集…";

    const series = buildDailySeries();
    if (tab === "activity") {
        renderSvgBarChart(dashMiniChart, series);

        const tools = Object.entries(SOURCE_NAMES)
            .map(([k, label]) => ({ k, label, tokens: report?.totals?.[k]?.tokens || 0 }))
            .sort((a, b) => b.tokens - a.tokens);
        const topTool = Math.max(1, tools[0]?.tokens || 1);

        const projects = (report?.projects || []).slice(0, 5);
        const topProj = Math.max(1, projects[0]?.tokens || 1);

        dashBreakdown.innerHTML = `
          <div class="dash-breakdown-col">
            <div class="dash-breakdown-title">AI 工具分布</div>
            ${tools.map(t => {
                const pct = totalTokens > 0 ? Math.round((t.tokens / totalTokens) * 100) : 0;
                return `<div class="dash-bd-row">
                  <span class="dash-bd-name"><span class="home-dot" style="background:${sourceColor(t.k)}"></span>${t.label}</span>
                  <div class="dash-bd-bar-bg"><div class="dash-bd-bar-fill" style="width:${Math.round((t.tokens / topTool) * 100)}%;background:${sourceColor(t.k)}"></div></div>
                  <span class="dash-bd-val">${fmtCompact(t.tokens)}</span>
                  <span class="dash-bd-pct">${pct}%</span>
                </div>`;
            }).join("")}
          </div>
          <div class="dash-breakdown-col">
            <div class="dash-breakdown-title">高频工作区</div>
            ${projects.length ? projects.map(p => {
                const pct = totalTokens > 0 ? Math.round((p.tokens / totalTokens) * 100) : 0;
                return `<div class="dash-bd-row">
                  <span class="dash-bd-name" title="${esc(p.directory)}"><span class="home-dot" style="background:${sourceColor(p.sources?.[0])}"></span>${esc(p.name)}</span>
                  <div class="dash-bd-bar-bg"><div class="dash-bd-bar-fill" style="width:${Math.round((p.tokens / topProj) * 100)}%;background:var(--accent)"></div></div>
                  <span class="dash-bd-val">${fmtCompact(p.tokens)}</span>
                  <span class="dash-bd-pct">${pct}%</span>
                </div>`;
            }).join("") : `<div class="empty-state">暂无项目用量</div>`}
          </div>
        `;
    } else {
        renderSvgBarChart(dashChart, series);
        const nonZero = [...series].reverse().filter(s => s.tokens > 0);
        dashLegend.innerHTML = (nonZero.length ? nonZero : [...series].reverse().slice(0, 7)).map(row => {
            const pct = totalTokens > 0 ? ((row.tokens / totalTokens) * 100).toFixed(1) : "0.0";
            return `<div class="dash-legend-row">
              <span>${row.date}</span>
              <strong>${fmtNum(row.tokens)} tok</strong>
              <span style="color:var(--muted)">${pct}%</span>
            </div>`;
        }).join("");
    }
}

document.addEventListener("mousemove", (event) => {
    const bar = event.target.closest?.(".bar-hover");
    if (!bar) {
        dashTooltip.classList.add("hidden");
        return;
    }
    dashTooltip.innerHTML = `<div style="font-weight:600;margin-bottom:3px">${bar.dataset.date}</div><div>${fmtNum(Number(bar.dataset.tokens))} Tokens</div>`;
    dashTooltip.classList.remove("hidden");
    const x = Math.min(window.innerWidth - 150, event.clientX + 12);
    const y = Math.max(10, event.clientY - 46);
    dashTooltip.style.left = `${x}px`;
    dashTooltip.style.top = `${y}px`;
});

activityTab.addEventListener("click", () => { tab = "activity"; render(); });
trendsTab.addEventListener("click", () => { tab = "trends"; render(); });
rangeGroup.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-days]");
    if (!btn) return;
    const next = Number(btn.dataset.days);
    days = next;
    if (next > 7 && !state?.usage?.history?.[next]) {
        state = await window.qlex.usagePeriod(next);
    }
    render();
});

flatToggle.addEventListener("click", async () => {
    state = await window.qlex.updateAppearance({ dashboardFlat: !state?.appearance?.dashboardFlat });
    render();
});
refreshBtn.addEventListener("click", async () => {
    state = days > 7 ? await window.qlex.usagePeriod(days) : await window.qlex.refreshUsage();
    render();
});
minBtn.addEventListener("click", () => void window.qlex.minimizeWindow());
closeBtn.addEventListener("click", () => void window.qlex.closeWindow());

window.qlex.onNativeMaterial?.((mat) => {
    if (state) state.nativeMaterial = mat;
    window.QlexTheme.applyNativeMaterial(mat);
});
window.qlex.onStateChanged?.((next) => { state = next; render(); });
window.qlex.onDashboardTab?.((nextTab) => { tab = nextTab === "trends" ? "trends" : "activity"; render(); });
window.addEventListener("resize", render);

(async () => {
    state = await window.qlex.getState();
    const mat = await window.qlex.getNativeMaterial();
    if (mat) state.nativeMaterial = mat;
    render();
})();
