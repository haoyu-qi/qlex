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

    const windows = data?.quotas?.codex?.windows?.filter(w => !w.resetsAt || w.resetsAt > Date.now());
    if (!windows?.length) {
        quotaRingText.textContent = "—";
        quotaRingFill.style.strokeDashoffset = "81.68";
        return;
    }
    const rem = Math.max(0, Math.min(100, Math.round(Math.min(...windows.map(w => 100 - w.used)))));
    quotaRingText.textContent = `${rem}`;
    quotaRingFill.style.strokeDashoffset = String((81.68 * (100 - rem)) / 100);
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
    const titles = { sync: "同步与本机技能", usage: "今日用量", limits: "Codex 订阅额度", memory: "记忆压缩归档" };
    const targets = { sync: "devices", usage: "usage", limits: "limits", memory: "memory" };
    const openLabels = { sync: "管理设备与 Skills ", usage: "查看工具用量 ", limits: "查看额度详情 ", memory: "打开记忆归档 " };
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
            list.append(row("中心点", online ? "在线" : "未启动", `${attachedOnline}/${paired} 附加在线 · ${pending} 待确认`));
        } else if (mode === "endpoint") {
            list.append(row(center || "中心点", status === "pending" ? "待确认" : online ? "已连接" : "未连接"));
        } else {
            list.append(row("本机设备", "单机模式", name));
        }
        list.append(row("本机 Skills", `${data.skills?.uniqueSkills ?? 0} 项`, data.skills?.missingLinks ? `${data.skills.missingLinks} 项待同步对齐` : "各工具已对齐"));
        list.append(row("登记项目", `${projects} 个`));

        quickAction.hidden = false;
        quickAction.dataset.quick = "sync";
        quickAction.classList.add(st.phase);
        quickAction.disabled = st.phase === "syncing";
        quickAction.textContent = st.phase === "syncing" ? "⟳ 正在同步…" : `⟳ 立即同步（${st.label}）`;
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
    } else if (item === "limits") {
        const codex = data.quotas?.codex;
        if (!codex?.windows?.length) {
            const p = document.createElement("p");
            p.textContent = "暂无本机 Codex 额度采样";
            details.append(p);
        } else {
            for (const w of codex.windows) {
                const expired = w.resetsAt && w.resetsAt <= Date.now();
                const rem = expired ? "已重置" : `剩余 ${Math.round(100 - w.used)}%`;
                list.append(row(w.minutes ? `${w.minutes} 分钟窗口` : "当前周期", rem, w.resetsAt ? `重置 ${new Date(w.resetsAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : ""));
            }
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
        quickAction.textContent = "⚡ 压缩并反思记忆";
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
