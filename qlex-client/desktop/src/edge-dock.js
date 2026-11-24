"use strict";

const os = require("node:os");
const {
    EDGE_DOCK_METRICS, createEdgeDockIntent, edgeDockRailBounds, edgeDockCellAt,
    edgeDockBubbleBounds, edgeDockCorridorBounds, edgeDockPollDelay, rectContains,
    edgeDockPeekBounds, edgeDockHandleBounds, edgeDockHandleZones, edgeDockTriggerBounds,
} = require("../vendor/token-monitor/geometry");
const { railCommands, bubbleCommands, peekCommands, toPolygons } = require("../vendor/token-monitor/shapes");
const { rasterizeMask } = require("../vendor/token-monitor/mask");
const { applyVibrancyMask } = require("../vendor/token-monitor/macVibrancyMask");
const { createMacLiquidGlass } = require("../vendor/token-monitor/macLiquidGlass");
const { createCardWindowVisibility } = require("../vendor/token-monitor/cardWindow");

const items = ["sync", "memory", "projects", "usage"];
const metrics = {
    ...EDGE_DOCK_METRICS,
    railWidth: 50,
    shoulder: 22,
    railRadius: 15,
    padding: 3,
    cellHeight: 48,
    minCellHeight: 36,
    hitRadius: 22,
    bubbleWidth: 298,
    peekWidth: 12,
    peekLength: 92,
    handleWidth: 6,
    handleLength: 70,
    handleNearWidth: 9,
    handleNearLength: 82,
    wakeDepth: 16,
    approachDepth: 42,
    approachSlack: 22,
    triggerDepth: 4,
};

function dockLayout(display, side) {
    const { bounds, workArea: available } = display;
    const workArea = { ...available, x: bounds.x, width: bounds.width };
    const rail = edgeDockRailBounds({ workArea, side, offset: 0.5, cellCount: items.length, metrics });
    const peek = edgeDockPeekBounds({ workArea, side, railBounds: rail, metrics });
    const handle = edgeDockHandleBounds({ side, peekBounds: peek, metrics });
    const handleZones = edgeDockHandleZones({ side, peekBounds: peek, metrics });
    const trigger = edgeDockTriggerBounds({ workArea, displayBounds: bounds, side, railBounds: rail, metrics });

    const bubbleWidth = Math.min(metrics.bubbleWidth, workArea.width - rail.width - metrics.bubbleTail - metrics.bubbleGap);
    const cards = items.map((_, cellIndex) => edgeDockBubbleBounds({
        railBounds: rail,
        cellIndex,
        height: Math.min(286, workArea.height - metrics.screenMargin * 2),
        workArea,
        side,
        metrics: { ...metrics, bubbleWidth },
    }));

    const railCmds = railCommands({ ...rail, side, shoulder: metrics.shoulder, radius: metrics.railRadius });
    const peekCmds = peekCommands({ ...peek, side, handleWidth: metrics.handleWidth, handleLength: metrics.handleLength });
    const peekNearCmds = peekCommands({ ...peek, side, handleWidth: metrics.handleNearWidth, handleLength: metrics.handleNearLength });
    const cardCmds = cards.map(card => bubbleCommands({
        ...card,
        side,
        tail: metrics.bubbleTail,
        neck: metrics.bubbleNeck,
        radius: metrics.bubbleRadius,
    }));

    return {
        rail,
        peek,
        handle,
        handleZones,
        trigger,
        cards,
        railCommands: railCmds,
        peekCommands: peekCmds,
        peekNearCommands: peekNearCmds,
        cardCommands: cardCmds,
        railPolygons: toPolygons(railCmds),
        peekPolygons: toPolygons(peekCmds),
        peekNearPolygons: toPolygons(peekNearCmds),
        cardPolygons: cardCmds.map(cmds => toPolygons(cmds)),
        railOutline: toPolygons(railCmds)[0],
        cardOutlines: cardCmds.map(cmds => toPolygons(cmds)[0]),
        scaleFactor: display.scaleFactor || 2,
    };
}

function insideOutline(bounds, outline, point) {
    if (!rectContains(bounds, point)) return false;
    const x = point.x - bounds.x;
    const y = point.y - bounds.y;
    let inside = false;
    for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index++) {
        const [ax, ay] = outline[previous];
        const [bx, by] = outline[index];
        if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) inside = !inside;
    }
    return inside;
}

function createEdgeDock({
    BrowserWindow,
    screen,
    uiPath,
    preload,
    panel,
    onError,
    getMaterialOptions = () => ({ enabled: true, liquidGlass: false, style: "regular", tintOpacity: 0, dark: true, reducedTransparency: false }),
    prefersReducedMotion = () => false,
}) {
    const windows = {};
    const glasses = {};
    const ready = new Set();
    const mouseRouting = new Map();
    const materialState = { peek: "none", rail: "none", card: "none" };
    const intent = createEdgeDockIntent();
    // Default autoHide: hidden as a slim edge handle, pops out when mouse hovers!
    let mode = "autoHide";
    intent.setAlways(false);
    const visibility = createCardWindowVisibility({ reducedMotion: prefersReducedMotion });

    let displayId, layout, timer;
    let shownItem = null;
    let railVisible = false;
    let peekNear = false;
    let blocked = false;
    let side = "off";

    const alive = win => win && !win.isDestroyed();
    const liquidGlassSupported = process.platform === "darwin" && Number.parseInt(os.release(), 10) >= 25;

    function presentation() {
        const snap = intent.snapshot();
        const index = snap.cell;
        const card = layout?.cards[index ?? 0];
        return {
            side,
            mode,
            revealed: snap.revealed,
            peekNear,
            item: items[index] ?? null,
            shoulder: metrics.shoulder,
            railRadius: metrics.railRadius,
            handleWidth: peekNear ? metrics.handleNearWidth : metrics.handleWidth,
            handleLength: peekNear ? metrics.handleNearLength : metrics.handleLength,
            cellTops: layout?.rail.cells.tops,
            cellHeights: layout?.rail.cells.heights,
            tailY: card?.tailY,
            tail: metrics.bubbleTail,
            neck: metrics.bubbleNeck,
            bubbleRadius: metrics.bubbleRadius,
            material: materialState,
        };
    }

    function disposeSurfaceGlass(surface, windowClosed = false) {
        const glass = glasses[surface];
        delete glasses[surface];
        if (!glass) return;
        try { glass.dispose({ windowClosed }); } catch { /* ignore */ }
    }

    function surfaceGeometry(surface) {
        if (!layout) return null;
        if (surface === "peek") {
            return {
                bounds: layout.peek,
                commands: peekNear ? layout.peekNearCommands : layout.peekCommands,
                polygons: peekNear ? layout.peekNearPolygons : layout.peekPolygons,
            };
        }
        if (surface === "rail") {
            return { bounds: layout.rail, commands: layout.railCommands, polygons: layout.railPolygons };
        }
        const index = intent.snapshot().cell ?? 0;
        return {
            bounds: layout.cards[index],
            commands: layout.cardCommands[index],
            polygons: layout.cardPolygons[index],
        };
    }

    function syncSurfaceMaterial(surface) {
        const win = windows[surface];
        const geom = surfaceGeometry(surface);
        if (!alive(win) || !geom) return;
        if (process.platform !== "darwin") {
            materialState[surface] = "none";
            return;
        }
        const opts = getMaterialOptions();
        const { bounds, commands, polygons } = geom;
        const wantsGlass = opts.enabled && !opts.reducedTransparency && opts.liquidGlass && liquidGlassSupported;

        if (wantsGlass) {
            try {
                win.setVibrancy(null);
                if (!glasses[surface]) glasses[surface] = createMacLiquidGlass(win, { shaped: true });
                glasses[surface].update({
                    dark: opts.dark !== false,
                    style: opts.style || "regular",
                    tintOpacity: opts.tintOpacity,
                    visible: true,
                    shape: { commands, width: bounds.width, height: bounds.height },
                });
                materialState[surface] = "liquid-glass";
                return;
            } catch {
                disposeSurfaceGlass(surface, false);
            }
        } else {
            disposeSurfaceGlass(surface, false);
        }

        if (opts.enabled && !opts.reducedTransparency) {
            try {
                win.setVibrancy("hud");
                const mask = rasterizeMask(polygons, bounds.width, bounds.height, layout.scaleFactor || 2);
                if (applyVibrancyMask(win, mask, bounds.width, bounds.height)) {
                    materialState[surface] = "vibrancy";
                    return;
                }
                win.setVibrancy(null);
            } catch {
                try { win.setVibrancy(null); } catch { /* ignore */ }
            }
        } else {
            try { win.setVibrancy(null); } catch { /* ignore */ }
        }
        materialState[surface] = "none";
    }

    function syncMaterial() {
        if (side === "off") return;
        for (const surface of ["peek", "rail", "card"]) syncSurfaceMaterial(surface);
        present();
    }

    function place(win, rectangle) {
        if (!alive(win) || !rectangle) return;
        const { x, y, width, height } = rectangle;
        const current = win.getBounds();
        if (x !== current.x || y !== current.y || width !== current.width || height !== current.height)
            win.setBounds({ x, y, width, height });
    }

    function routeMouse(win, acceptsInput) {
        if (!alive(win) || mouseRouting.get(win) === acceptsInput) return;
        win.setIgnoreMouseEvents(!acceptsInput);
        mouseRouting.set(win, acceptsInput);
    }

    function syncVisibility() {
        const snap = intent.snapshot();
        const rail = windows.rail;
        const peek = windows.peek;
        const card = windows.card;

        // 1. Rail visibility (autoHide vs always)
        const wantRail = Boolean(snap.revealed);
        if (ready.has("rail") && alive(rail) && wantRail !== railVisible) {
            railVisible = wantRail;
            if (!wantRail) routeMouse(rail, false);
            visibility.setVisible(rail, wantRail, undefined, {
                afterFade: () => { if (!railVisible && alive(rail)) rail.hide(); },
            });
        }

        // 2. Peek handle visibility (shown only while rail is retracted in autoHide mode)
        if (ready.has("peek") && alive(peek)) {
            const wantPeek = mode === "autoHide" && !wantRail;
            routeMouse(peek, wantPeek);
            if (wantPeek) {
                if (!peek.isVisible()) peek.showInactive();
                peek.setOpacity(1);
            } else if (peek.isVisible()) {
                peek.hide();
            }
        }

        // 3. Bubble card visibility
        if (!ready.has("card") || !alive(card)) return;
        const nextItem = wantRail ? (items[snap.cell] ?? null) : null;
        if (nextItem === shownItem) return;
        const stayingOpen = Boolean(shownItem && nextItem);
        shownItem = nextItem;
        if (!nextItem) routeMouse(card, false);
        if (stayingOpen) return;
        visibility.setVisible(card, Boolean(nextItem), undefined, {
            afterFade: () => { if (!shownItem && alive(card)) card.hide(); },
        });
    }

    function present() {
        const snap = intent.snapshot();
        const index = snap.cell;
        const card = windows.card;
        if (index !== null && layout && alive(card)) {
            place(card, layout.cards[index]);
            syncSurfaceMaterial("card");
        }
        const value = presentation();
        for (const surface of ready) {
            const win = windows[surface];
            if (alive(win)) win.webContents.send("qlex:dock-presentation", value);
        }
        syncVisibility();
    }

    function dismiss() {
        blocked = true;
        intent.retract();
        present();
    }

    function reposition() {
        if (side === "off") return;
        const display = screen.getAllDisplays().find(item => item.id === displayId) || screen.getPrimaryDisplay();
        displayId = display.id;
        layout = dockLayout(display, side);
        place(windows.peek, layout.peek);
        place(windows.rail, layout.rail);
        syncSurfaceMaterial("peek");
        syncSurfaceMaterial("rail");
        syncSurfaceMaterial("card");
        present();
    }

    function close() {
        clearTimeout(timer);
        timer = undefined;
        for (const surface of ["peek", "rail", "card"]) {
            const win = windows[surface];
            disposeSurfaceGlass(surface, false);
            delete windows[surface];
            ready.delete(surface);
            materialState[surface] = "none";
            if (win) {
                visibility.cancel(win);
                mouseRouting.delete(win);
            }
            if (alive(win)) win.close();
        }
        shownItem = null;
        railVisible = false;
        peekNear = false;
        intent.retract();
    }

    function create(surface) {
        const mac = process.platform === "darwin";
        const initialBounds = surface === "peek" ? layout.peek : surface === "rail" ? layout.rail : layout.cards[0];
        const win = new BrowserWindow({
            ...initialBounds,
            title: surface === "peek" ? "QLEX 边缘把手" : surface === "rail" ? "QLEX 侧边吸附" : "QLEX 快览",
            frame: false, transparent: true, show: false, movable: false, resizable: false,
            minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
            focusable: surface === "card", alwaysOnTop: true, hasShadow: false,
            backgroundColor: "#00000000",
            ...(mac ? { type: "panel", acceptFirstMouse: true } : {}),
            webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
        });
        windows[surface] = win;
        routeMouse(win, false);
        if (mac) {
            win.setAlwaysOnTop(true, "floating");
            win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
            win.setHiddenInMissionControl(true);
        }
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        win.webContents.on("will-navigate", event => event.preventDefault());
        win.on("closed", () => {
            disposeSurfaceGlass(surface, true);
            if (windows[surface] === win) close();
        });
        void win.loadFile(uiPath, { query: { surface } }).then(() => {
            if (windows[surface] !== win || !alive(win)) return;
            ready.add(surface);
            syncSurfaceMaterial(surface);
            present();
        }).catch(error => {
            if (windows[surface] !== win) return;
            close();
            onError(error);
        });
    }

    function poll() {
        const point = screen.getCursorScreenPoint();
        const snap = intent.snapshot();
        const index = snap.cell;
        const bubble = index === null ? null : layout.cards[index];
        const inPeek = rectContains(layout.peek, point);
        const inWake = rectContains(layout.handleZones?.wake, point);
        const inApproach = rectContains(layout.handleZones?.approach, point);
        const inTrigger = rectContains(layout.trigger, point);
        const inRail = snap.revealed && insideOutline(layout.rail, layout.railOutline, point);
        const inBubble = snap.revealed && bubble ? insideOutline(bubble, layout.cardOutlines[index], point) : false;

        if (!snap.revealed && inApproach !== peekNear) {
            peekNear = inApproach;
            syncSurfaceMaterial("peek");
            present();
        }

        routeMouse(windows.rail, inRail);
        routeMouse(windows.card, inBubble);
        if (!inRail && !inPeek && !inTrigger) blocked = false;

        if (ready.has("rail") && !blocked) {
            const effects = intent.tick({
                inTrigger,
                inPeek,
                inWake,
                inRail,
                cellIndex: inRail ? edgeDockCellAt(point, layout.rail, items.length, metrics) : null,
                inBubble,
                inCorridor: snap.revealed && bubble ? rectContains(edgeDockCorridorBounds(layout.rail, bubble), point) : false,
            });
            if (effects.length) present();
        }
        timer = setTimeout(poll, edgeDockPollDelay({ revealed: snap.revealed, near: inApproach || inRail }));
    }

    function apply(value, source, nextMode) {
        if (nextMode === "autoHide" || nextMode === "always") {
            mode = nextMode;
            intent.setAlways(mode === "always");
        }
        if (value !== side) {
            intent.retract();
            blocked = false;
        }
        side = value;
        if (side === "off") {
            close();
            return;
        }
        if (source && !source.isDestroyed()) displayId = screen.getDisplayMatching(source.getBounds()).id;
        reposition();
        for (const surface of ["peek", "rail", "card"]) if (!alive(windows[surface])) create(surface);
        if (!timer) poll();
    }

    function setMode(nextMode) {
        if (nextMode !== "autoHide" && nextMode !== "always") return;
        mode = nextMode;
        intent.setAlways(mode === "always");
        if (mode === "autoHide") intent.retract();
        present();
    }

    function follow(source) {
        if (side === "off") return;
        const selected = screen.getDisplayMatching(source.getBounds()).id;
        if (selected === displayId) return;
        displayId = selected;
        dismiss();
        reposition();
    }

    return {
        apply,
        setMode,
        close,
        follow,
        reposition,
        presentation,
        dismiss,
        syncMaterial,
        openDashboard(page) { dismiss(); panel(page); },
        pin(item) {
            const index = items.indexOf(item);
            if (index !== -1) {
                blocked = false;
                intent.reveal({ pinned: false });
                intent.focusCell(index);
                present();
            }
        },
        side: () => side,
        mode: () => mode,
        owns: win => Object.values(windows).includes(win),
        surface: sender => Object.keys(windows).find(key => windows[key]?.webContents === sender),
    };
}

module.exports = { createEdgeDock, dockLayout };
