"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const node_assert_1 = require("node:assert");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const node_url_1 = require("node:url");
const state_1 = require("./state");
const pairing_1 = require("./pairing");
const { findAutoMatchDirectory } = require("./project-sync");
const { createUsageCollector } = require("./usage");
const { createSkillSync } = require("./skill-sync");
const { createMemoryArchiver } = require("./memory-archive");
const { installMemorySkill, getMemorySkillStatus } = require("./memory-skill");
const { createTailscaleManager } = require("./tailscale");
const { createUpdater } = require("./updater");
const { createEdgeDock } = require("./edge-dock");
const { createTrayAnimator } = require("./tray-animator");
const APP_VERSION = require("../../package.json").version;
const {
    attachNativeMaterialVisibility,
    syncNativeMaterialVisibility,
    getNativeMaterialState,
} = require("../vendor/token-monitor/nativeMaterialVisibility");
const {
    isLiquidGlassBackdrop,
    liquidGlassStyle,
    liquidGlassTint,
} = require("../vendor/token-monitor/macBackdropMode");

const smoke = process.argv.includes("--qlex-smoke");
const smokeDirectory = smoke ? (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "qlex-smoke-")) : undefined;
const uiPath = (0, node_path_1.join)(__dirname, "../ui/index.html");
const uiUrl = (0, node_url_1.pathToFileURL)(uiPath).href;
const dashboardPath = (0, node_path_1.join)(__dirname, "../ui/dashboard.html");
const dashboardUrl = (0, node_url_1.pathToFileURL)(dashboardPath).href;
const menubarPath = (0, node_path_1.join)(__dirname, "../ui/menubar.html");
const menubarUrl = (0, node_url_1.pathToFileURL)(menubarPath).href;
const dockPath = (0, node_path_1.join)(__dirname, "../ui/dock.html");
const dockUrl = (0, node_url_1.pathToFileURL)(dockPath).href;
const logo = (0, node_path_1.join)(electron_1.app.getAppPath(), "docs/assets/brand/logo.png");
const trayLogo = (0, node_path_1.join)(electron_1.app.getAppPath(), "docs/assets/brand/tray-icon.png");
const trayFramesDir = (0, node_path_1.join)(electron_1.app.getAppPath(), "docs/assets/brand/tray-frames");

const DEFAULT_WINDOW = { width: 1080, height: 720 };
const MENUBAR_POPOVER = { width: 352, height: 746 };
const WINDOW_LIMITS = { minWidth: 880, minHeight: 620, maxWidth: 1800, maxHeight: 1400 };
const LIQUID_GLASS_SUPPORTED = process.platform === "darwin" && Number.parseInt(node_os_1.release(), 10) >= 25;

let store;
let pairing;
let usage;
let skills;
let memoryArchive;
let tailscale;
let updater;
let edgeDock;
let changingRole = false;
let syncRunning = null;
let syncState = { phase: "idle", label: "待同步", detail: "", time: 0 };
let window;
let dashboardWindow;
let menubarWindow;
let lastMenubarShowAt = 0;
let tray;
let trayAnimator;
let trayContextMenu;
let trayStatus;
let queuedPage;
let persistBoundsTimer;
let quitting = false;

electron_1.app.setName("QLEX");
if (smokeDirectory)
    electron_1.app.setPath("userData", smokeDirectory);

function isLightPreset(appearance) {
    return appearance?.themePreset === "porcelain";
}

function nativeMaterialOptions(appearance = store?.snapshot().appearance, dashboard = false) {
    const a = appearance || state_1.DEFAULT_APPEARANCE;
    return {
        enabled: a.systemGlass !== false,
        liquidGlass: isLiquidGlassBackdrop(a.macBackdrop),
        style: liquidGlassStyle(a.macBackdrop),
        tintOpacity: liquidGlassTint(a, a.macBackdrop),
        opaque: dashboard && a.dashboardFlat === true,
        reducedTransparency: electron_1.nativeTheme.prefersReducedTransparency === true,
        highContrast: electron_1.nativeTheme.shouldUseHighContrastColors === true,
        dark: !isLightPreset(a),
        radius: 14,
    };
}

function applyAllNativeMaterials(appearance = store?.snapshot().appearance) {
    if (window && !window.isDestroyed()) {
        syncNativeMaterialVisibility(window, nativeMaterialOptions(appearance, false));
        window.setAlwaysOnTop(Boolean(appearance?.alwaysOnTop), appearance?.alwaysOnTop ? "floating" : "normal");
    }
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        syncNativeMaterialVisibility(dashboardWindow, nativeMaterialOptions(appearance, true));
    }
    if (menubarWindow && !menubarWindow.isDestroyed()) {
        syncNativeMaterialVisibility(menubarWindow, nativeMaterialOptions(appearance, false));
    }
    edgeDock?.syncMaterial();
}

function computeSyncSummary() {
    if (syncState.phase === "syncing") {
        return { phase: "syncing", label: "同步中…", detail: syncState.detail || "正在同步本机技能、配对与记忆", time: syncState.time };
    }
    const net = pairing.view();
    const sk = skills.snapshot();
    const mem = memoryArchive.snapshot();

    if (syncState.phase === "error" || sk.phase === "error" || mem.phase === "error") {
        return { phase: "error", label: "同步异常", detail: syncState.detail || mem.error || "部分同步失败，点击重试", time: syncState.time };
    }
    if (sk.conflicts > 0) {
        return { phase: "conflict", label: `冲突 ${sk.conflicts}`, detail: "部分本机 Skills 存在本地改动冲突", time: Math.max(syncState.time, sk.time) };
    }
    if (net.mode === "endpoint" && net.endpoint?.status === "pending") {
        return { phase: "pending", label: "待确认", detail: "等待中心端确认配对", time: syncState.time };
    }
    if (net.mode === "center" && net.peers.some(p => p.status === "pending")) {
        const count = net.peers.filter(p => p.status === "pending").length;
        return { phase: "pending", label: `待确认 ${count}`, detail: `${count} 台新设备等待批准`, time: syncState.time };
    }
    if (net.mode === "endpoint" && !net.online) {
        return { phase: "offline", label: "中心离线", detail: "本机 Skills 与记忆仍可正常归档", time: syncState.time };
    }
    const lastTime = Math.max(syncState.time, sk.localTime || 0, sk.time || 0, mem.lastRun || 0);
    if (lastTime > 0) {
        const t = new Date(lastTime).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
        return {
            phase: "synced",
            label: `已同步 ${t}`,
            detail: `技能 ${sk.uniqueSkills} · 记忆 ${mem.counts.daily}日/${mem.counts.weekly}周/${mem.counts.monthly}月`,
            time: lastTime,
        };
    }
    return {
        phase: "idle",
        label: sk.missingLinks > 0 ? `待同步 ${sk.missingLinks}` : "立即同步",
        detail: sk.missingLinks > 0 ? `本机有 ${sk.missingLinks} 项工具技能待对齐` : "点击同步本机技能、用量与记忆归档",
        time: 0,
    };
}

let lastBroadcastFp = "";

function broadcastState(state, { force = false } = {}) {
    const payload = desktopState(state);
    const fp = JSON.stringify(payload);
    if (!force && fp === lastBroadcastFp) {
        return payload;
    }
    lastBroadcastFp = fp;
    for (const target of [window, dashboardWindow, menubarWindow]) {
        if (target && !target.isDestroyed()) {
            target.webContents.send("qlex:state-changed", payload);
        }
    }
    return payload;
}

function desktopState(state = store.snapshot()) {
    const { pairing: _privatePairing, ...local } = state;
    updateTray();
    const usageSnap = usage.snapshot();
    const discovered = usageSnap?.week?.projects || [];
    const boundDirSet = new Set((local.projects || []).map(p => p.directory));
    const projectAutoMatches = {};
    for (const rp of local.remoteProjects || []) {
        const match = findAutoMatchDirectory(rp, discovered, boundDirSet);
        if (match) projectAutoMatches[rp.syncId] = match;
    }
    return {
        ...local,
        version: APP_VERSION,
        usage: usageSnap,
        projectAutoMatches,
        skills: skills.snapshot(),
        memoryArchive: memoryArchive.snapshot(),
        memorySkill: getMemorySkillStatus({ namespaces: local.localSkillNamespaces }),
        tailscale: tailscale ? tailscale.snapshot() : null,
        updater: updater ? updater.snapshot() : null,
        syncStatus: computeSyncSummary(),
        pairing: pairing.view(),
        deviceName: (0, node_os_1.hostname)(),
        trayAvailable: Boolean(tray),
        platform: process.platform,
        liquidGlassSupported: LIQUID_GLASS_SUPPORTED,
        nativeMaterial: window && !window.isDestroyed() ? getNativeMaterialState(window) : null,
    };
}

async function runUnifiedSync() {
    if (syncRunning) return syncRunning;
    syncRunning = (async () => {
        syncState = { phase: "syncing", label: "双向同步中…", detail: "正在同步中心/接入点记忆、项目、本机 Skills 与 Agent 检索技能", time: syncState.time };
        broadcastState();
        const snap = store.snapshot();
        try {
            if (pairing.view().mode !== "local") {
                await pairing.refresh().catch(() => {});
            }

            // 1. Core: Bidirectional Memory Sync & Project Sync (Endpoint <-> Center)
            if (pairing.view().mode === "endpoint" && pairing.view().endpoint?.status === "connected") {
                await Promise.all([
                    pairing.syncMemory().catch(err => console.warn("QLEX memory sync warning:", err?.message || err)),
                    pairing.syncProjects().catch(err => console.warn("QLEX project sync warning:", err?.message || err)),
                ]);
            } else {
                await pairing.syncProjects().catch(() => {});
            }

            // 2. Core: Local Cognitive Memory Compression + Universal Agent Skill
            if (snap.skillSyncEnabled) {
                installMemorySkill({ namespaces: snap.localSkillNamespaces });
                skills.syncLocal(snap.localSkillNamespaces);
                if (pairing.view().mode === "endpoint") {
                    await skills.refresh(pairing, snap.localSkillNamespaces);
                }
            } else {
                skills.scanLocal(snap.localSkillNamespaces);
            }

            if (snap.memoryAutoCompress !== false) {
                await memoryArchive.compressNow();
            }

            // 3. Auxiliary: background usage & Tailscale peer scan
            void usage.refresh().catch(() => {});
            void tailscale?.refreshAndDiscover().catch(() => {});

            syncState = { phase: "synced", label: "已同步", detail: "", time: Date.now() };
        } catch (err) {
            syncState = { phase: "error", label: "同步异常", detail: err?.message || "同步过程中出现异常", time: Date.now() };
        }
        return broadcastState();
    })().finally(() => { syncRunning = null; });
    return syncRunning;
}

function persistBoundsSoon() {
    clearTimeout(persistBoundsTimer);
    persistBoundsTimer = setTimeout(() => {
        if (!window || window.isDestroyed() || window.isMinimized()) return;
        const b = window.getBounds();
        store.setWindowBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
    }, 350);
}

function restoredBounds() {
    const saved = store.snapshot().windowBounds;
    if (!saved || typeof saved.width !== "number" || saved.width < WINDOW_LIMITS.minWidth) return DEFAULT_WINDOW;
    const upgradedWidth = saved.width < DEFAULT_WINDOW.width && saved.height < 680 ? DEFAULT_WINDOW.width : saved.width;
    const upgradedHeight = saved.height < 680 ? DEFAULT_WINDOW.height : saved.height;
    const width = Math.min(WINDOW_LIMITS.maxWidth, Math.max(WINDOW_LIMITS.minWidth, upgradedWidth));
    const height = Math.min(WINDOW_LIMITS.maxHeight, Math.max(WINDOW_LIMITS.minHeight, upgradedHeight));
    if (typeof saved.x === "number" && typeof saved.y === "number") {
        const display = electron_1.screen.getDisplayMatching({ x: saved.x, y: saved.y, width, height });
        const area = display?.workArea;
        if (area) {
            const x = Math.max(area.x - width + 120, Math.min(area.x + area.width - 120, saved.x));
            const y = Math.max(area.y, Math.min(area.y + area.height - 120, saved.y));
            return { x, y, width, height };
        }
    }
    return { width, height };
}

function showWindow() {
    if (window && !window.isDestroyed()) {
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        return window;
    }
    const bounds = restoredBounds();
    const appearance = store.snapshot().appearance;
    const created = new electron_1.BrowserWindow({
        width: bounds.width,
        height: bounds.height,
        ...(typeof bounds.x === "number" ? { x: bounds.x, y: bounds.y } : {}),
        ...WINDOW_LIMITS,
        title: "QLEX",
        icon: logo,
        frame: false,
        transparent: true,
        resizable: true,
        backgroundColor: "#00000000",
        ...(process.platform === "darwin" ? { vibrancy: "hud", visualEffectState: "active" } : {}),
        show: false,
        webPreferences: {
            preload: (0, node_path_1.join)(__dirname, "preload.js"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });
    window = created;
    if (appearance?.alwaysOnTop) {
        created.setAlwaysOnTop(true, "floating");
    }
    attachNativeMaterialVisibility(created, () => nativeMaterialOptions(store.snapshot().appearance, false));
    syncNativeMaterialVisibility(created, nativeMaterialOptions(store.snapshot().appearance, false));

    created.on("move", () => { edgeDock?.follow(created); persistBoundsSoon(); });
    created.on("resize", persistBoundsSoon);
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    created.once("ready-to-show", () => {
        syncNativeMaterialVisibility(created, nativeMaterialOptions(store.snapshot().appearance, false));
        if (!smoke) created.show();
    });
    created.on("close", (event) => {
        if (!quitting && tray && store.snapshot().keepRunning) {
            event.preventDefault();
            created.hide();
        }
    });
    created.on("closed", () => { window = undefined; });
    void created.loadFile(uiPath).then(() => {
        syncNativeMaterialVisibility(created, nativeMaterialOptions(store.snapshot().appearance, false));
        if (queuedPage && !created.isDestroyed()) {
            created.webContents.send("qlex:navigate", queuedPage);
            queuedPage = undefined;
        }
        if (smoke)
            void smokeTest(created);
    }).catch((error) => {
        console.error(error);
        if (smoke)
            electron_1.app.exit(1);
        else
            electron_1.dialog.showErrorBox("QLEX 无法加载", "请重新打开应用。");
    });
    return created;
}

function openDashboardWindow(tab = "activity") {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
        if (dashboardWindow.isMinimized()) dashboardWindow.restore();
        dashboardWindow.show();
        dashboardWindow.focus();
        if (!dashboardWindow.webContents.isLoadingMainFrame()) {
            dashboardWindow.webContents.send("qlex:dashboard-tab", tab);
        }
        return dashboardWindow;
    }
    const created = new electron_1.BrowserWindow({
        width: 940,
        height: 640,
        minWidth: 620,
        minHeight: 440,
        title: "QLEX · 用量看板",
        icon: logo,
        frame: false,
        transparent: true,
        backgroundColor: "#00000000",
        ...(process.platform === "darwin" ? { vibrancy: "hud", visualEffectState: "active" } : {}),
        show: false,
        webPreferences: {
            preload: (0, node_path_1.join)(__dirname, "preload.js"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });
    dashboardWindow = created;
    attachNativeMaterialVisibility(created, () => nativeMaterialOptions(store.snapshot().appearance, true));
    syncNativeMaterialVisibility(created, nativeMaterialOptions(store.snapshot().appearance, true));
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    created.once("ready-to-show", () => {
        syncNativeMaterialVisibility(created, nativeMaterialOptions(store.snapshot().appearance, true));
        if (!smoke) created.show();
    });
    created.on("closed", () => {
        if (dashboardWindow === created) dashboardWindow = undefined;
    });
    void created.loadFile(dashboardPath, { query: { tab: tab === "trends" ? "trends" : "activity" } }).then(() => {
        syncNativeMaterialVisibility(created, nativeMaterialOptions(store.snapshot().appearance, true));
    }).catch(console.error);
    return created;
}

let lastMenubarHeight = MENUBAR_POPOVER.height;

function positionMenubarPopover(win, targetHeight = lastMenubarHeight) {
    if (!win || win.isDestroyed() || !tray) return;
    const tb = tray.getBounds();
    const display = electron_1.screen.getDisplayNearestPoint({ x: tb.x, y: tb.y });
    const area = display?.workArea || electron_1.screen.getPrimaryDisplay().workArea;
    const width = MENUBAR_POPOVER.width;
    const desired = Number.isFinite(targetHeight) && targetHeight > 300 ? Math.ceil(targetHeight) : MENUBAR_POPOVER.height;
    const height = Math.min(Math.max(460, desired), Math.max(460, area.height - 20));
    lastMenubarHeight = height;
    const rawX = Math.round(tb.x + tb.width / 2 - width / 2);
    const x = Math.max(area.x + 8, Math.min(area.x + area.width - width - 8, rawX));
    const y = process.platform === "darwin"
        ? Math.round(tb.y + tb.height + 6)
        : Math.max(area.y + 8, Math.round(tb.y - height - 6));
    win.setBounds({ x, y, width, height }, false);
}

function createMenubarPopover() {
    if (menubarWindow && !menubarWindow.isDestroyed()) return menubarWindow;
    const created = new electron_1.BrowserWindow({
        width: MENUBAR_POPOVER.width,
        height: MENUBAR_POPOVER.height,
        title: "QLEX 菜单栏状态面板",
        icon: logo,
        frame: false,
        transparent: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        backgroundColor: "#00000000",
        ...(process.platform === "darwin" ? { vibrancy: "hud", visualEffectState: "active" } : {}),
        show: false,
        webPreferences: {
            preload: (0, node_path_1.join)(__dirname, "preload.js"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
        },
    });
    menubarWindow = created;
    if (process.platform === "darwin") {
        created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    const matOpts = () => nativeMaterialOptions(store.snapshot().appearance, false);
    attachNativeMaterialVisibility(created, matOpts);
    syncNativeMaterialVisibility(created, matOpts());
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    created.on("blur", () => {
        if (Date.now() - lastMenubarShowAt < 250) return;
        if (!created.isDestroyed() && created.isVisible()) {
            created.hide();
        }
    });
    created.on("closed", () => {
        if (menubarWindow === created) menubarWindow = undefined;
    });
    void created.loadFile(menubarPath).then(() => {
        syncNativeMaterialVisibility(created, matOpts());
        if (!created.isDestroyed()) {
            created.webContents.send("qlex:state-changed", desktopState());
        }
    }).catch(console.error);
    return created;
}

function toggleMenubarPopover(forceShow = false) {
    if (smoke) return;
    const target = createMenubarPopover();
    if (!forceShow && target.isVisible()) {
        target.hide();
        return;
    }
    positionMenubarPopover(target);
    lastMenubarShowAt = Date.now();
    if (!target.webContents.isLoadingMainFrame()) {
        target.webContents.send("qlex:state-changed", desktopState());
        target.webContents.send("qlex:menubar-shown");
    }
    syncNativeMaterialVisibility(target, nativeMaterialOptions(store.snapshot().appearance, false));
    target.show();
    target.focus();
}

function navigateDashboard(page) {
    const hadWindow = Boolean(window && !window.isDestroyed());
    const target = showWindow();
    if (hadWindow && !target.webContents.isLoadingMainFrame())
        target.webContents.send("qlex:navigate", page);
    else
        queuedPage = page;
}

function applyEdgeDock(side) {
    const next = store.setEdgeDock(side);
    edgeDock.apply(side, window, next.edgeDockMode);
    updateTray();
    return broadcastState(next);
}

function applyEdgeDockMode(mode) {
    const next = store.setEdgeDockMode(mode);
    edgeDock.setMode(mode);
    updateTray();
    return broadcastState(next);
}

function createTray() {
    const templatePath = (0, node_fs_1.existsSync)(trayLogo) ? trayLogo : logo;
    const original = electron_1.nativeImage.createFromPath(templatePath);
    if (original.isEmpty())
        return;
    const mark = original.resize({ width: 19, height: 19 });
    mark.setTemplateImage(process.platform === "darwin");
    tray = new electron_1.Tray(mark);
    trayAnimator = createTrayAnimator({
        tray,
        nativeImage: electron_1.nativeImage,
        framesDir: trayFramesDir,
        fallbackImage: mark,
    });
    tray.on("click", () => {
        toggleMenubarPopover(false);
    });
    tray.on("right-click", () => {
        if (menubarWindow && !menubarWindow.isDestroyed() && menubarWindow.isVisible()) {
            menubarWindow.hide();
        }
        if (trayContextMenu) {
            tray.popUpContextMenu(trayContextMenu);
        }
    });
    updateTray();
}

function updateTray() {
    if (!tray)
        return;
    const network = pairing.view();
    const snap = store.snapshot();
    const appearance = snap.appearance;
    const syncInfo = computeSyncSummary();
    const sk = skills.snapshot();
    const pendingPeers = (network.peers || []).filter(p => p.status === "pending").length;
    let status = "仅在本机使用";
    if (network.mode === "center")
        status = network.online ? "中心点 · 运行中" : "中心点 · 未启动";
    if (network.mode === "endpoint") {
        status = network.endpoint?.status === "pending" ? "接入点 · 待确认" : network.online ? "接入点 · 已连接" : "接入点 · 未连接";
    }
    const dockSide = edgeDock?.side() || "off";
    const dockMode = snap.edgeDockMode || "autoHide";
    const trayBadge = syncInfo.phase === "syncing" ? " ⟳"
        : sk.conflicts > 0 ? " !"
        : pendingPeers > 0 ? " •" : "";
    const fingerprint = `${status}|${syncInfo.label}|${trayBadge}|${dockSide}|${dockMode}|${appearance?.alwaysOnTop}|${appearance?.macBackdrop}`;
    if (trayStatus === fingerprint)
        return;
    trayStatus = fingerprint;
    tray.setToolTip(`QLEX · ${status} · ${syncInfo.label}`);
    if (process.platform === "darwin") {
        tray.setTitle(trayBadge);
    }
    const animMode = syncInfo.phase === "syncing"
        ? "syncing"
        : (sk.conflicts > 0 || pendingPeers > 0 || (network.mode !== "local" && !network.online))
            ? "warn"
            : "idle";
    trayAnimator?.setMode(animMode);
    const backdropSubmenu = [
        { label: "经典毛玻璃 (HUD Vibrancy)", type: "radio", checked: appearance.macBackdrop === "vibrancy", click: () => { const next = store.setAppearance({ macBackdrop: "vibrancy", systemGlass: true }); applyAllNativeMaterials(next.appearance); broadcastState(next); } },
        ...(LIQUID_GLASS_SUPPORTED ? [
            { label: "macOS 液态玻璃 (Liquid Glass)", type: "radio", checked: appearance.macBackdrop === "liquid-glass", click: () => { const next = store.setAppearance({ macBackdrop: "liquid-glass", systemGlass: true }); applyAllNativeMaterials(next.appearance); broadcastState(next); } },
            { label: "清透液态玻璃 (Clear Glass)", type: "radio", checked: appearance.macBackdrop === "liquid-glass-clear", click: () => { const next = store.setAppearance({ macBackdrop: "liquid-glass-clear", systemGlass: true }); applyAllNativeMaterials(next.appearance); broadcastState(next); } },
        ] : []),
    ];
    const menu = electron_1.Menu.buildFromTemplate([
        { label: "打开菜单栏状态面板", click: () => { toggleMenubarPopover(true); } },
        { label: "打开 QLEX 主窗口", click: () => { showWindow(); } },
        { label: "打开用量大屏看板", click: () => { openDashboardWindow("activity"); } },
        { label: `立即同步（${syncInfo.label}）`, click: () => { void runUnifiedSync(); } },
        { label: status, enabled: false },
        { type: "separator" },
        { label: "窗口置顶", type: "checkbox", checked: Boolean(appearance?.alwaysOnTop), click: () => {
            const next = store.setAppearance({ alwaysOnTop: !store.snapshot().appearance?.alwaysOnTop });
            applyAllNativeMaterials(next.appearance);
            broadcastState(next);
        } },
        { label: "毛玻璃材质", submenu: backdropSubmenu },
        { label: "侧边吸附", submenu: [
            { label: "关闭", type: "radio", checked: dockSide === "off", click: () => applyEdgeDock("off") },
            { label: "左侧", type: "radio", checked: dockSide === "left", click: () => applyEdgeDock("left") },
            { label: "右侧", type: "radio", checked: dockSide === "right", click: () => applyEdgeDock("right") },
            { type: "separator" },
            { label: "鼠标悬浮弹出（默认）", type: "radio", checked: dockMode === "autoHide", click: () => applyEdgeDockMode("autoHide") },
            { label: "始终停靠显示", type: "radio", checked: dockMode === "always", click: () => applyEdgeDockMode("always") },
        ] },
        { type: "separator" },
        { label: "退出 QLEX", click: () => electron_1.app.quit() },
    ]);
    trayContextMenu = menu;
    if (process.platform !== "darwin") {
        tray.setContextMenu(menu);
    }
}

async function changeRole(operation) {
    if (changingRole)
        throw new Error("设备角色正在切换，请稍候。");
    changingRole = true;
    try {
        await operation();
        return broadcastState(store.snapshot().configured ? store.snapshot() : store.configure());
    }
    finally {
        changingRole = false;
    }
}

async function discoveredDirectory(directory) {
    const { today, week, history } = usage.snapshot();
    const reports = [today, week, ...Object.values(history)];
    if (!store.snapshot().configured || typeof directory !== "string" ||
        !reports.some(report => report?.projects.some(project => project.directory === directory)))
        throw new Error("该工作区已不在采集结果中，请刷新项目列表。");
    return node_fs_1.promises.realpath(directory).catch(() => {
        throw new Error("该工作区目录在本机不可用。");
    });
}

async function requireDirectory(directory) {
    if (!(await node_fs_1.promises.stat(directory).catch(() => undefined))?.isDirectory())
        throw new Error("无法访问项目目录，请检查目录位置或磁盘连接。");
}

async function openDirectory(directory) {
    await requireDirectory(directory);
    if (await electron_1.shell.openPath(directory))
        throw new Error("无法打开项目目录，请检查系统权限。");
    return desktopState();
}

function isMainOrDashboardSender(event) {
    if (event.sender === window?.webContents && event.senderFrame?.url === uiUrl) return "main";
    if (event.sender === dashboardWindow?.webContents && event.senderFrame?.url.startsWith(dashboardUrl)) return "dashboard";
    if (event.sender === menubarWindow?.webContents && event.senderFrame?.url === menubarUrl) return "menubar";
    return null;
}

function registerHandlers() {
    const sharedHandlers = {
        "qlex:state": () => desktopState(),
        "qlex:sync-now": () => runUnifiedSync(),
        "qlex:native-material": (_value, event) => {
            const target = event.sender === dashboardWindow?.webContents ? dashboardWindow
                : event.sender === menubarWindow?.webContents ? menubarWindow
                : window;
            return target && !target.isDestroyed() ? getNativeMaterialState(target) : null;
        },
        "qlex:update-appearance": (patch) => {
            const next = store.setAppearance(patch);
            applyAllNativeMaterials(next.appearance);
            return broadcastState(next);
        },
        "qlex:window-minimize": (_value, event) => {
            const target = event.sender === dashboardWindow?.webContents ? dashboardWindow : window;
            target?.minimize();
        },
        "qlex:window-close": (_value, event) => {
            const target = event.sender === dashboardWindow?.webContents ? dashboardWindow : window;
            target?.close();
        },
        "qlex:window-toggle-pin": () => {
            const next = store.setAppearance({ alwaysOnTop: !store.snapshot().appearance?.alwaysOnTop });
            applyAllNativeMaterials(next.appearance);
            return broadcastState(next);
        },
        "qlex:open-main-page": (page) => {
            if (menubarWindow && !menubarWindow.isDestroyed() && menubarWindow.isVisible()) {
                menubarWindow.hide();
            }
            navigateDashboard(page || "home");
            return desktopState();
        },
        "qlex:close-menubar-popover": () => {
            if (menubarWindow && !menubarWindow.isDestroyed() && menubarWindow.isVisible()) {
                menubarWindow.hide();
            }
        },
        "qlex:resize-menubar-popover": (height) => {
            if (menubarWindow && !menubarWindow.isDestroyed()) {
                const clamped = Math.max(520, Math.min(860, Math.ceil(Number(height) || MENUBAR_POPOVER.height)));
                if (Math.abs(clamped - lastMenubarHeight) >= 2) {
                    positionMenubarPopover(menubarWindow, clamped);
                }
            }
        },
        "qlex:open-dashboard": (tab) => {
            openDashboardWindow(tab);
            return desktopState();
        },
        "qlex:refresh-usage": async () => { await usage.refresh(); return broadcastState(); },
        "qlex:usage-period": async (days) => {
            try {
                await usage.history(days);
                return broadcastState();
            } catch {
                throw new Error("无法读取这个时间范围的本机用量。");
            }
        },
    };

    const mainOnlyHandlers = {
        "qlex:set-edge-dock": applyEdgeDock,
        "qlex:set-edge-dock-mode": applyEdgeDockMode,
        "qlex:set-skill-sync": async (enabled) => {
            store.setSkillSync(enabled);
            if (enabled) {
                skills.scanLocal(store.snapshot().localSkillNamespaces);
                void skills.refresh(pairing, store.snapshot().localSkillNamespaces);
            }
            return broadcastState();
        },
        "qlex:set-skill-namespaces": (namespaces) => {
            const next = store.setLocalSkillNamespaces(namespaces);
            skills.scanLocal(next.localSkillNamespaces);
            return broadcastState(next, { force: true });
        },
        "qlex:set-skill-sync-policy": (patch) => {
            const next = store.setSkillSyncPolicy(patch);
            skills.scanLocal(next.localSkillNamespaces);
            return broadcastState(next, { force: true });
        },
        "qlex:toggle-skill-excluded": (input) => {
            const next = store.toggleExcludedSkill(input?.name, input?.excluded);
            skills.scanLocal(next.localSkillNamespaces);
            return broadcastState(next, { force: true });
        },
        "qlex:sync-local-skills": async () => {
            const snap = store.snapshot();
            skills.syncLocal(snap.localSkillNamespaces);
            if (snap.skillSyncEnabled && pairing.view().mode === "endpoint") {
                await skills.refresh(pairing, snap.localSkillNamespaces);
            }
            return broadcastState();
        },
        "qlex:resolve-skill-conflict": (input) => {
            const snap = store.snapshot();
            const result = skills.resolveConflict(input?.name, input?.sourceNs, snap.localSkillNamespaces);
            return { result, state: broadcastState() };
        },
        "qlex:resolve-all-skill-conflicts": (strategy) => {
            const snap = store.snapshot();
            const result = skills.resolveAllConflicts(strategy || "latest", snap.localSkillNamespaces);
            return { result, state: broadcastState() };
        },
        "qlex:repair-skill-anomalies": () => {
            const snap = store.snapshot();
            const result = skills.repairAnomalies(snap.localSkillNamespaces);
            return { result, state: broadcastState() };
        },
        "qlex:open-skill-backup-dir": async () => {
            const dir = skills.snapshot().backupRoot;
            node_fs_1.mkdirSync(dir, { recursive: true });
            await electron_1.shell.openPath(dir);
            return desktopState();
        },
        "qlex:open-skill-dir": async (namespace) => {
            const info = skills.snapshot().namespaces?.[namespace];
            if (!info?.path) throw new Error("未知的技能目录。");
            node_fs_1.mkdirSync(info.path, { recursive: true });
            await electron_1.shell.openPath(info.path);
            return desktopState();
        },
        "qlex:compress-memory": async () => {
            await memoryArchive.compressNow();
            return broadcastState();
        },
        "qlex:read-memory-archive": (input) => memoryArchive.readEntry(input?.kind, input?.key),
        "qlex:memory-recall": (input) => memoryArchive.recall(input?.query || "", input || {}),
        "qlex:memory-retain": (input) => {
            const result = memoryArchive.retain(input || {});
            return { result, state: broadcastState() };
        },
        "qlex:memory-reflect": (input) => {
            const result = memoryArchive.reflect(input || {});
            return { result, state: broadcastState() };
        },
        "qlex:memory-graph": (input) => memoryArchive.graphQuery(input || {}),
        "qlex:memory-browse": (input) => memoryArchive.browse(input?.uri || "qlex://", input?.level || "L1"),
        "qlex:memory-forget": (input) => {
            const result = memoryArchive.forget(input?.id, input || {});
            return { result, state: broadcastState() };
        },
        "qlex:install-memory-skill": () => {
            const snap = store.snapshot();
            const result = installMemorySkill({ namespaces: snap.localSkillNamespaces });
            skills.scanLocal(snap.localSkillNamespaces);
            return { result, state: broadcastState() };
        },
        "qlex:memory-skill-status": () => getMemorySkillStatus({ namespaces: store.snapshot().localSkillNamespaces }),
        "qlex:choose-memory-dir": async () => {
            if (!window) throw new Error("窗口未就绪");
            const result = await electron_1.dialog.showOpenDialog(window, { properties: ["openDirectory", "createDirectory"] });
            if (result.canceled || !result.filePaths[0]) return desktopState();
            const next = store.setMemoryArchiveDir((0, node_fs_1.realpathSync)(result.filePaths[0]));
            memoryArchive.reloadIndex();
            await memoryArchive.compressNow();
            return broadcastState(next);
        },
        "qlex:open-memory-dir": async () => {
            const dir = store.snapshot().memoryArchiveDir;
            node_fs_1.mkdirSync(dir, { recursive: true });
            await electron_1.shell.openPath(dir);
            return desktopState();
        },
        "qlex:open-memory-file": async (input) => {
            const entry = memoryArchive.readEntry(input?.kind, input?.key);
            await electron_1.shell.openPath(entry.mdPath);
            return desktopState();
        },
        "qlex:set-memory-auto": (enabled) => broadcastState(store.setMemoryAutoCompress(enabled)),
        "qlex:set-collector-path": async (input) => {
            store.setCollectorPath(input?.source, input?.dir);
            await usage.refresh();
            return broadcastState();
        },
        "qlex:tailscale-scan": async () => {
            await tailscale.refreshAndDiscover();
            return broadcastState();
        },
        "qlex:tailscale-start-embedded": (input) => {
            tailscale.startEmbedded(input || {});
            return broadcastState();
        },
        "qlex:tailscale-stop-embedded": () => {
            tailscale.stopEmbedded();
            return broadcastState();
        },
        "qlex:tailscale-open-auth": async () => {
            const url = tailscale.snapshot().authURL;
            if (!url) throw new Error("当前没有待打开的 Tailscale 登录链接。");
            await electron_1.shell.openExternal(url);
            return desktopState();
        },
        "qlex:update-check": async (force) => {
            await updater.checkForUpdates({ force: Boolean(force) });
            return broadcastState();
        },
        "qlex:update-download": async () => {
            await updater.downloadUpdate();
            return broadcastState();
        },
        "qlex:update-install": async () => {
            const file = updater.snapshot().downloadedFile;
            if (!file || !node_fs_1.existsSync(file)) throw new Error("未找到已校验的安装包，请先下载更新。");
            const err = await electron_1.shell.openPath(file);
            if (err) throw new Error("无法拉起安装程序：" + err);
            return desktopState();
        },
        "qlex:update-open-release": async () => {
            const url = updater.snapshot().latest?.htmlUrl || "https://github.com/haoyu-qi/qlex/releases";
            await electron_1.shell.openExternal(url);
            return desktopState();
        },
        "qlex:set-update-channel": async (channel) => {
            const next = store.setUpdateChannel(channel);
            await updater.checkForUpdates({ force: true });
            return broadcastState(next);
        },
        "qlex:set-auto-updates": (enabled) => broadcastState(store.setAutoCheckUpdates(enabled)),
        "qlex:configure-local": () => broadcastState(store.configure()),
        "qlex:enable-center": () => changeRole(() => pairing.start()),
        "qlex:join-center": (code) => changeRole(() => pairing.join(code)),
        "qlex:use-local": () => changeRole(() => pairing.useLocal()),
        "qlex:refresh-pairing": async () => {
            await pairing.refresh();
            return desktopState();
        },
        "qlex:create-invite": (host) => {
            const code = pairing.createInvite(host);
            electron_1.clipboard.writeText(code);
            return broadcastState(undefined, { force: true });
        },
        "qlex:copy-invite": () => {
            const active = pairing.view().activeInvite;
            const code = active?.code || pairing.createInvite();
            electron_1.clipboard.writeText(code);
            return broadcastState(undefined, { force: true });
        },
        "qlex:approve-device": (id) => { pairing.decide(id, true); return broadcastState(); },
        "qlex:remove-device": (id) => { pairing.decide(id, false); return broadcastState(); },
        "qlex:keep-running": (enabled) => {
            if (typeof enabled !== "boolean")
                throw new Error("无效的后台运行设置");
            return broadcastState(store.setKeepRunning(enabled));
        },
        "qlex:add-discovered-project": async (directory) => {
            const resolved = await discoveredDirectory(directory);
            await requireDirectory(resolved);
            store.addProject(resolved);
            await pairing.syncProjects().catch(err => console.warn("QLEX project sync after discover add:", err?.message || err));
            return broadcastState(undefined, { force: true });
        },
        "qlex:open-discovered-project": async (directory) => openDirectory(await discoveredDirectory(directory)),
        "qlex:open-project": (id) => openDirectory(store.projectById(id).directory),
        "qlex:rename-project": async (input) => {
            store.renameProject(input?.id, input?.name);
            await pairing.syncProjects().catch(err => console.warn("QLEX project sync after rename:", err?.message || err));
            return broadcastState(undefined, { force: true });
        },
        "qlex:remove-project": async (id) => {
            const { name } = store.projectById(id);
            const options = {
                type: "question",
                message: "将项目移出列表？",
                detail: `可以随时重新添加「${name}」的目录；若已连接中心，移出操作将同步至对端。`,
                buttons: ["取消", "移出列表"],
                defaultId: 0,
                cancelId: 0,
            };
            const { response } = await electron_1.dialog.showMessageBox(window, options);
            if (response === 1) {
                store.removeProject(id);
                await pairing.syncProjects().catch(err => console.warn("QLEX project sync after remove:", err?.message || err));
                return broadcastState(undefined, { force: true });
            }
            return desktopState();
        },
        "qlex:choose-project": async () => {
            if (!window || !store.snapshot().configured)
                throw new Error("请先完成首次设置");
            const result = await electron_1.dialog.showOpenDialog(window, { properties: ["openDirectory"] });
            if (result.canceled || !result.filePaths[0])
                return desktopState();
            store.addProject((0, node_fs_1.realpathSync)(result.filePaths[0]));
            await pairing.syncProjects().catch(err => console.warn("QLEX project sync after add:", err?.message || err));
            return broadcastState(undefined, { force: true });
        },
        "qlex:bind-remote-project": async (input) => {
            if (!store.snapshot().configured)
                throw new Error("请先完成首次设置");
            const syncId = typeof input === "string" ? input : input?.syncId;
            const directDir = typeof input === "object" && typeof input?.directory === "string" ? input.directory : "";
            let chosenDir = "";
            if (directDir) {
                const resolved = (0, node_fs_1.realpathSync)(directDir);
                await requireDirectory(resolved);
                chosenDir = resolved;
            } else {
                if (menubarWindow && !menubarWindow.isDestroyed() && menubarWindow.isVisible()) {
                    menubarWindow.hide();
                }
                const parent = window && !window.isDestroyed() && window.isVisible() ? window : undefined;
                const result = parent
                    ? await electron_1.dialog.showOpenDialog(parent, { properties: ["openDirectory"] })
                    : await electron_1.dialog.showOpenDialog({ properties: ["openDirectory"] });
                if (result.canceled || !result.filePaths[0])
                    return desktopState();
                chosenDir = (0, node_fs_1.realpathSync)(result.filePaths[0]);
            }
            store.bindRemoteProject(syncId, chosenDir);
            await pairing.syncProjects().catch(err => console.warn("QLEX project sync after bind:", err?.message || err));
            return broadcastState(undefined, { force: true });
        },
        "qlex:sync-memory-now": async () => {
            let remote = null;
            if (pairing.view().mode === "endpoint") {
                remote = await pairing.syncMemory();
            }
            await memoryArchive.compressNow();
            return { remote, state: broadcastState(undefined, { force: true }) };
        },
        "qlex:sync-projects-now": async () => {
            const remote = await pairing.syncProjects();
            void usage.refresh().then(() => broadcastState()).catch(() => {});
            return { remote, state: broadcastState(undefined, { force: true }) };
        },
    };

    const dockHandlers = {
        "qlex:dock-state": () => {
            const { today, quotas } = usage.snapshot();
            const { mode, online, endpoint, peers } = pairing.view();
            const sk = skills.snapshot();
            const mem = memoryArchive.snapshot();
            return {
                ...edgeDock.presentation(),
                appearance: store.snapshot().appearance,
                syncStatus: computeSyncSummary(),
                today: today && { total: today.total, totals: today.totals },
                quotas,
                skills: {
                    uniqueSkills: sk.uniqueSkills,
                    missingLinks: sk.missingLinks,
                    localSynced: sk.localSynced,
                    conflicts: sk.conflicts,
                },
                memory: {
                    archiveDir: mem.archiveDir,
                    counts: mem.counts,
                    cognitive: mem.cognitive,
                    compressionRatio: mem.compressionRatio,
                    lastRun: mem.lastRun,
                    latestDaily: mem.items?.daily?.[0] || null,
                    skill: getMemorySkillStatus({ namespaces: store.snapshot().localSkillNamespaces }),
                },
                projects: {
                    boundCount: store.snapshot().projects.length,
                    remoteCount: (store.snapshot().remoteProjects || []).length,
                    items: store.snapshot().projects.slice(0, 4).map(p => ({ name: p.name, directory: p.directory })),
                    remoteItems: (store.snapshot().remoteProjects || []).slice(0, 3).map(r => ({ name: r.name, originDevice: r.originDevice })),
                },
                sync: {
                    mode, online, center: endpoint?.name, status: endpoint?.status,
                    paired: peers.filter(peer => peer.status === "connected").length,
                    attachedOnline: peers.filter(peer => peer.online).length,
                    pending: peers.filter(peer => peer.status === "pending").length,
                    name: (0, node_os_1.hostname)(), projects: store.snapshot().projects.length,
                    tailscaleOnline: Boolean(tailscale?.snapshot().online),
                    tailscaleIp: tailscale?.snapshot().self?.ip || "",
                    discoveredCount: tailscale?.snapshot().discoveredCenters?.length || 0,
                    syncMeta: pairing.view().syncMeta,
                },
                updater: updater ? {
                    phase: updater.snapshot().phase,
                    latestVersion: updater.snapshot().latest?.version || "",
                } : null,
            };
        },
        "qlex:dock-pin": (value) => edgeDock.pin(value),
        "qlex:dock-dismiss": () => edgeDock.dismiss(),
        "qlex:dock-sync": async () => { await runUnifiedSync(); return dockHandlers["qlex:dock-state"](); },
        "qlex:dock-compress-memory": async () => { await memoryArchive.compressNow(); broadcastState(); return dockHandlers["qlex:dock-state"](); },
        "qlex:dock-open": (page) => edgeDock.openDashboard(["usage", "limits", "memory", "sessions", "projects", "devices", "overview"].includes(page) ? page : "overview"),
    };

    for (const [channel, handler] of Object.entries(dockHandlers)) {
        electron_1.ipcMain.handle(channel, (event, value) => {
            const surface = edgeDock.surface(event.sender);
            if (!surface || event.senderFrame?.url !== dockUrl + "?surface=" + surface)
                throw new Error("QLEX IPC source rejected");
            return handler(value);
        });
    }
    for (const [channel, handler] of Object.entries(sharedHandlers)) {
        electron_1.ipcMain.handle(channel, (event, value) => {
            if (!isMainOrDashboardSender(event))
                throw new Error("QLEX IPC source rejected");
            return handler(value, event);
        });
    }
    for (const [channel, handler] of Object.entries(mainOnlyHandlers)) {
        electron_1.ipcMain.handle(channel, (event, value) => {
            const sender = isMainOrDashboardSender(event);
            if (sender !== "main" && sender !== "menubar")
                throw new Error("QLEX IPC source rejected");
            return handler(value, event);
        });
    }
}

async function smokeTest(created) {
    try {
        const result = await created.webContents.executeJavaScript(`
      (async () => {
        const before = await window.qlex.getState();
        document.querySelector('[data-action="continue"]').click();
        for (let count = 0; count < 100 && !document.querySelector('.nav-capsule-btn.active'); count++) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        const after = await window.qlex.getState();
        const memState = await window.qlex.compressMemory();
        return {
          before: before.configured,
          after: after.configured,
          edgeDockMode: after.edgeDockMode,
          dailyArchives: memState.memoryArchive.counts.daily,
          weeklyArchives: memState.memoryArchive.counts.weekly,
          monthlyArchives: memState.memoryArchive.counts.monthly,
        };
      })()
    `);
        node_assert_1.strict.equal(result.before, false);
        node_assert_1.strict.equal(result.after, true);
        node_assert_1.strict.equal(result.edgeDockMode, "autoHide");
        node_assert_1.strict.ok(result.dailyArchives >= 1);
        node_assert_1.strict.ok(result.weeklyArchives >= 1);
        node_assert_1.strict.ok(result.monthlyArchives >= 1);
        console.log("QLEX smoke passed:", JSON.stringify(result));
        electron_1.app.quit();
    }
    catch (error) {
        console.error(error);
        electron_1.app.exit(1);
    }
}

if (!smoke && !electron_1.app.requestSingleInstanceLock()) {
    electron_1.app.quit();
}
else {
    electron_1.app.on("second-instance", () => { if (electron_1.app.isReady() && store) showWindow(); });
    electron_1.app.on("activate", () => { if (store) showWindow(); });
    electron_1.app.on("before-quit", () => { quitting = true; });
    electron_1.app.on("will-quit", () => {
        clearTimeout(persistBoundsTimer);
        trayAnimator?.stop();
        pairing?.stop();
        tailscale?.stop();
        edgeDock?.close();
        if (menubarWindow && !menubarWindow.isDestroyed()) {
            menubarWindow.destroy();
        }
        if (smokeDirectory)
            (0, node_fs_1.rmSync)(smokeDirectory, { recursive: true, force: true });
    });
    electron_1.app.on("window-all-closed", () => {
        const hasVisibleAppWindow = [window, dashboardWindow].some(w => w && !w.isDestroyed());
        if (!hasVisibleAppWindow && (!tray || !store.snapshot().keepRunning))
            electron_1.app.quit();
    });
    void electron_1.app.whenReady().then(() => {
        const userDataDir = electron_1.app.getPath("userData");
        store = new state_1.LocalStore((0, node_path_1.join)(userDataDir, "state.json"));
        usage = createUsageCollector({
            cachePath: (0, node_path_1.join)(userDataDir, "collector-cache.json"),
            getCustomPaths: () => store.snapshot().collectorPaths,
        });
        skills = createSkillSync(userDataDir, undefined, {
            getPolicy: () => store.snapshot().skillSyncPolicy,
        });
        skills.scanLocal(store.snapshot().localSkillNamespaces);
        memoryArchive = createMemoryArchiver({
            getArchiveDir: () => store.snapshot().memoryArchiveDir,
            getProjects: () => store.snapshot().projects,
            getUsageSnapshot: () => usage.snapshot(),
            getTopicsByDate: () => usage.getTopicsByDate(),
        });
        tailscale = createTailscaleManager({
            dataDir: userDataDir,
            getCenterInfo: () => {
                const v = pairing?.view();
                return v ? { mode: v.mode, online: v.online, port: v.port, deviceId: store.snapshot().deviceId, version: APP_VERSION } : null;
            },
            onChange: () => {
                if ((window && !window.isDestroyed()) || (menubarWindow && !menubarWindow.isDestroyed() && menubarWindow.isVisible())) {
                    broadcastState();
                }
            },
        });
        updater = createUpdater({
            currentVersion: APP_VERSION,
            getChannel: () => store.snapshot().updateChannel || "beta",
            onChange: () => {
                if ((window && !window.isDestroyed()) || (menubarWindow && !menubarWindow.isDestroyed() && menubarWindow.isVisible())) {
                    broadcastState();
                }
            },
            onUpdateFound: (latest) => {
                try {
                    if (!smoke && electron_1.Notification?.isSupported?.()) {
                        const n = new electron_1.Notification({
                            title: `发现 QLEX 新版本 ${latest.version}`,
                            body: latest.prerelease ? "Beta 更新通道已推送新版本，点击打开下载。" : "正式版更新已就绪，点击打开下载。",
                        });
                        n.on("click", () => { showWindow(); });
                        n.show();
                    }
                } catch { /* ignore notification errors */ }
            },
        });
        pairing = new pairing_1.DevicePairing(store, undefined, skills, () => {
            const ts = tailscale.snapshot();
            return [ts.self?.dnsName, ts.self?.ip].filter(Boolean);
        }, memoryArchive, () => {
            if ((window && !window.isDestroyed()) || (menubarWindow && !menubarWindow.isDestroyed() && menubarWindow.isVisible())) {
                broadcastState(undefined, { force: true });
            }
        });
        edgeDock = createEdgeDock({
            BrowserWindow: electron_1.BrowserWindow,
            screen: electron_1.screen,
            uiPath: dockPath,
            preload: (0, node_path_1.join)(__dirname, "preload.js"),
            panel: navigateDashboard,
            getMaterialOptions: () => nativeMaterialOptions(store.snapshot().appearance, false),
            prefersReducedMotion: () => process.platform === "darwin" &&
                electron_1.systemPreferences.getUserDefault("reduceMotion", "boolean"),
            onError: (error) => console.warn("QLEX Edge Dock unavailable", error.message),
        });

        electron_1.nativeTheme.on("updated", () => applyAllNativeMaterials(store.snapshot().appearance));

        if (!smoke) {
            for (const event of ["display-added", "display-removed", "display-metrics-changed"])
                electron_1.screen.on(event, edgeDock.reposition);
            tailscale.startLanDiscovery();
            void tailscale.refreshAndDiscover().catch(console.warn);
            void usage.refresh().then(() => {
                if (store.snapshot().memoryAutoCompress !== false) {
                    return memoryArchive.compressNow().then(() => broadcastState());
                }
            }).catch(console.warn);
            setInterval(() => void usage.refresh().catch(console.warn), 300_000).unref();
            setInterval(() => void tailscale.refreshAndDiscover().catch(console.warn), 45_000).unref();
            setInterval(() => {
                if (pairing.view().mode === "endpoint" && pairing.view().endpoint?.status === "connected") {
                    void pairing.syncMemory().catch(console.warn);
                    void pairing.syncProjects().catch(console.warn);
                }
                if (store.snapshot().skillSyncEnabled) void skills.refresh(pairing, store.snapshot().localSkillNamespaces);
            }, 60_000).unref();
            // Auto daily/weekly/monthly memory compression every 30 minutes
            setInterval(() => {
                if (store.snapshot().memoryAutoCompress !== false) {
                    void memoryArchive.compressNow().then(() => broadcastState()).catch(console.warn);
                }
            }, 1_800_000).unref();
            // Auto check updates on startup (after 12s) and every 6 hours
            setTimeout(() => {
                if (store.snapshot().autoCheckUpdates !== false) void updater.checkForUpdates().catch(console.warn);
            }, 12_000).unref();
            setInterval(() => {
                if (store.snapshot().autoCheckUpdates !== false) void updater.checkForUpdates().catch(console.warn);
            }, 6 * 3_600_000).unref();
        }
        try {
            createTray();
        }
        catch (error) {
            console.warn("QLEX tray unavailable", error);
        }
        registerHandlers();
        showWindow();
        if (!smoke && ["left", "right"].includes(store.snapshot().edgeDock))
            edgeDock.apply(store.snapshot().edgeDock, window, store.snapshot().edgeDockMode);
        if (pairing.view().mode === "center")
            void pairing.start().then(updateTray, updateTray);
        const refresh = () => {
            if (!changingRole)
                void pairing.refresh().then(updateTray).catch(console.warn);
        };
        refresh();
        if (!smoke) {
            if (store.snapshot().skillSyncEnabled) {
                try {
                    installMemorySkill({ namespaces: store.snapshot().localSkillNamespaces });
                    skills.scanLocal(store.snapshot().localSkillNamespaces);
                } catch (err) {
                    console.warn("QLEX memory skill install warning:", err?.message || err);
                }
            }
            void pairing.refresh().then(async () => {
                if (pairing.view().mode === "endpoint" && pairing.view().endpoint?.status === "connected") {
                    await Promise.all([
                        pairing.syncProjects().catch(err => console.warn("QLEX startup project sync:", err?.message || err)),
                        pairing.syncMemory().catch(err => console.warn("QLEX startup memory sync:", err?.message || err)),
                    ]);
                } else {
                    await pairing.syncProjects().catch(() => {});
                }
                if (store.snapshot().skillSyncEnabled) {
                    await skills.refresh(pairing, store.snapshot().localSkillNamespaces).catch(console.warn);
                }
                broadcastState(undefined, { force: true });
            }).catch(console.warn);
        }
        setInterval(refresh, 10_000).unref();
    }).catch((error) => {
        console.error(error);
        if (!smoke)
            electron_1.dialog.showErrorBox("QLEX 无法启动", "无法读取或保存本机工作台配置。请检查 QLEX 应用数据目录。");
        electron_1.app.exit(1);
    });
}
