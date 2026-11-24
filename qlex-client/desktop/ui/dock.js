"use strict";

const surface = new URLSearchParams(location.search).get("surface");
const rail = document.querySelector("#rail");
const card = document.querySelector("#card");
const details = document.querySelector("#details");
const quickAction = document.querySelector("#quickAction");
const openBtn = document.querySelector("#open");
const glass = document.querySelector("#glass");
const rim = document.querySelector("#rim");
const syncRailSvg = document.querySelector("#syncRailSvg");
const syncRailDot = document.querySelector("#syncRailDot");
const quotaRingFill = document.querySelector("#quotaRingFill");
const quotaRingText = document.querySelector("#quotaRingText");
const buttons = [...rail.querySelectorAll("button")];
const { railCommands, bubbleCommands, peekCommands, toSvgPath } = window.TokenMonitorEdgeDockShapes;
const sources = { antigravity: "Antigravity", codex: "Codex", claude: "Claude Code", hermes: "Hermes", dsh: "DSH" };
let data, presentation, request = 0;

document.body.classList.add(`surface-${surface || "rail"}`);

function row(label, value, caption) {
    const item = document.createElement("li");
    const heading = document.createElement("div");
    heading.textContent = label;
    if (caption) {
        const note = document.createElement("small");
        note.textContent = caption;
        heading.append(note);
    }
    const metric = document.createElement("strong");
    metric.textContent = value;
    item.append(heading, metric);
    return item;
}

function shape({ side, shoulder, railRadius, handleWidth, handleLength, tail, tailY, neck, bubbleRadius }) {
    const bounds = { width: innerWidth, height: innerHeight, side };
    if (surface === "peek") {
        const opts = { ...bounds, handleWidth: handleWidth || 6, handleLength: handleLength || 70 };
        glass.setAttribute("d", toSvgPath(peekCommands(opts)));
        rim.setAttribute("d", toSvgPath(peekCommands({ ...opts, open: true })));
    } else if (surface === "rail") {
        const options = { ...bounds, shoulder, radius: railRadius };
        glass.setAttribute("d", toSvgPath(railCommands(options)));
        rim.setAttribute("d", toSvgPath(railCommands({ ...options, open: true })));
    } else {
        const path = toSvgPath(bubbleCommands({ ...bounds, tail, neck, tailY, radius: bubbleRadius }));
        glass.setAttribute("d", path);
        rim.setAttribute("d", path);
    }
}

function syncMaterialClasses() {
    const mat = presentation?.material?.[surface] || "none";
    document.documentElement.classList.toggle("edge-dock-liquid-glass", mat === "liquid-glass");
    document.documentElement.classList.toggle("edge-dock-no-material", mat === "none");
}

function updateRailBadges() {
    const phase = data?.syncStatus?.phase || "idle";
    syncRailDot.className = `dock-status-dot ${phase}`;
    syncRailSvg.classList.toggle("is-spinning", phase === "syncing");
}

function render() {
    if (!presentation) return;
    if (data?.appearance) window.QlexTheme.applyAppearance(data.appearance);
    syncMaterialClasses();
    document.body.classList.toggle("right", presentation.side === "right");
    document.body.classList.toggle("peek-near", Boolean(presentation.peekNear));

    if (surface === "peek") {
        rail.hidden = true;
        card.hidden = true;
        shape(presentation);
        return;
    }

    if (!presentation.cellTops) return;
    const { item, cellTops, cellHeights } = presentation;
    if (surface === "rail" || item) shape(presentation);
    rail.hidden = surface !== "rail";
    card.hidden = surface !== "card";

    if (surface === "rail") {
        buttons.forEach((button, index) => {
            if (cellTops[index] != null) {
                button.style.top = cellTops[index] + "px";
                button.style.height = cellHeights[index] + "px";
            }
            button.setAttribute("aria-pressed", String(item === button.dataset.item));
        });
        updateRailBadges();
        return;
    }

    if (!item) return;
    const titles = { sync: "中心点与接入点", memory: "记忆同步与图谱", projects: "项目跨端同步", usage: "工具用量（辅助）" };
    const targets = { sync: "devices", memory: "memory", projects: "projects", usage: "usage" };
    const openLabels = { sync: "管理中心/接入点 ", memory: "打开记忆同步 ", projects: "管理项目工作区 ", usage: "查看用量统计 " };
    document.querySelector("#title").textContent = titles[item] || "QLEX";
    openBtn.dataset.page = targets[item] || "overview";
    openBtn.firstChild.textContent = openLabels[item] || "打开工作台 ";
    quickAction.hidden = true;
    quickAction.className = "quick-action-btn";
    details.replaceChildren();
    if (!data) return;

    const list = document.createElement("ul");
    if (item === "sync") {
        const st = data.syncStatus || { phase: "idle", label: "待同步" };
        const { mode, online, status, center, paired, attachedOnline, pending, projects, name } = data.sync;
        list.append(row("同步状态", st.label, st.detail || ""));
        if (mode === "center") {
            list.append(row("中心点", online ? "运行中" : "未启动", `${attachedOnline}/${paired} 接入在线 · ${pending} 待确认`));
        } else if (mode === "endpoint") {
            list.append(row(center || "接入中心", status === "pending" ? "待确认" : online ? "已连接" : "离线"));
        } else {
            list.append(row("节点角色", "单机模式", name));
        }
        if (data.sync?.tailscaleOnline) {
            list.append(row("Tailscale 内网", data.sync.tailscaleIp || "在线", data.sync.discoveredCount ? `发现 ${data.sync.discoveredCount} 台 QLEX 中心` : "自动穿透就绪"));
        }
        list.append(row("本机 Skills", `${data.skills?.uniqueSkills ?? 0} 项`, data.skills?.conflicts ? `冲突 ${data.skills.conflicts}` : data.skills?.missingLinks ? `${data.skills.missingLinks} 项待对齐` : "已对齐"));
        if (data.updater?.phase === "available" || data.updater?.phase === "ready") {
            list.append(row("版本更新推送", data.updater.latestVersion, data.updater.phase === "ready" ? "已校验待安装" : "可下载更新"));
        }

        quickAction.hidden = false;
        quickAction.dataset.quick = "sync";
        quickAction.classList.add(st.phase);
        quickAction.disabled = st.phase === "syncing";
        quickAction.textContent = st.phase === "syncing" ? "⟳ 双向同步中…" : "⟳ 同步记忆 · 项目 · 技能";
    } else if (item === "projects") {
        const pr = data.projects || { boundCount: 0, remoteCount: 0, items: [], remoteItems: [] };
        list.append(row("本机已绑定项目", `${pr.boundCount} 个`, pr.remoteCount ? `${pr.remoteCount} 个跨端共享项目待绑定` : "跨端目录已同步"));
        for (const p of pr.items || []) {
            list.append(row(p.name, "已绑定", p.directory));
        }
        for (const r of pr.remoteItems || []) {
            list.append(row(r.name, "待绑定", `来自 ${r.originDevice || "中心节点"}`));
        }
        quickAction.hidden = false;
        quickAction.dataset.quick = "sync";
        quickAction.textContent = "⟳ 同步跨端项目";
    } else if (item === "usage") {
        const value = document.createElement("p");
        value.className = "value";
        value.textContent = data.today?.total == null ? "暂无用量" : data.today.total.toLocaleString("zh-CN");
        details.append(value);
        const tools = Object.entries(data.today?.totals || {})
            .filter(([, result]) => result.tokens > 0)
            .sort((a, b) => b[1].tokens - a[1].tokens)
            .slice(0, 3);
        for (const [tool, usage] of tools) {
            list.append(row(sources[tool] || tool, usage.tokens.toLocaleString("zh-CN")));
        }
    } else if (item === "memory") {
        const mem = data.memory;
        const c = mem?.counts || { daily: 0, weekly: 0, monthly: 0 };
        const cog = mem?.cognitive || {};
        const sk = mem?.skill || {};
        list.append(row("原子记忆 / 图谱", `${cog.activeItems ?? 0} 项 · ${cog.entities ?? 0} 实体`, `${cog.activeEdges ?? 0} 活跃边 · ${cog.historicalEdges ?? 0} 演进链`));
        list.append(row("日 / 周 / 月归档", `${c.daily} / ${c.weekly} / ${c.monthly}`, `压缩率 ${mem?.compressionRatio ?? 0}%`));
        list.append(row("Agent 检索技能", `已部署 ${sk.installedCount ?? 0}/${sk.totalCount ?? 6}`, "qlex-memory (L0/L1/L2)"));
        quickAction.hidden = false;
        quickAction.dataset.quick = "memory";
        quickAction.textContent = "⚡ 同步并压缩记忆";
    }
    if (list.childElementCount) details.append(list);
}

async function refresh() {
    const current = ++request;
    const next = await window.qlex.dockState();
    if (current !== request) return;
    data = next;
    presentation ??= next;
    render();
}

window.qlex.onDockPresentation(value => {
    presentation = value;
    render();
    if ((surface === "card" && value.item) || surface === "rail") void refresh().catch(() => {});
});
window.addEventListener("resize", render);
rail.addEventListener("click", event => {
    const item = event.target.closest("[data-item]")?.dataset.item;
    if (item) void window.qlex.dockPin(item);
});
quickAction.addEventListener("click", async () => {
    quickAction.disabled = true;
    try {
        if (quickAction.dataset.quick === "sync") {
            data = await window.qlex.dockSyncNow();
        } else if (quickAction.dataset.quick === "memory") {
            data = await window.qlex.dockCompressMemory();
        }
        render();
    } finally {
        quickAction.disabled = false;
    }
});
openBtn.addEventListener("click", () => { void window.qlex.dockOpen(openBtn.dataset.page); });
document.querySelector("#dismiss").addEventListener("click", () => { void window.qlex.dockDismiss(); });
document.addEventListener("keydown", event => {
    if (event.key === "Escape") void window.qlex.dockDismiss();
});
if (surface === "card" || surface === "rail") {
    setInterval(() => { void refresh().catch(() => {}); }, 6000);
}
void refresh().catch(() => {});
