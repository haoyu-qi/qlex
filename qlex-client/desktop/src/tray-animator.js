"use strict";

/**
 * QLEX Native macOS Menubar Tray Icon Animator
 * - Loads pre-rendered Retina @2x (38x38) monochrome template frames once into memory
 * - Smooth orbital spin when syncing (110ms/frame), gentle ambient satellite glide when online (780ms/frame),
 *   soft alert pulse when conflicts/pending peers exist (850ms/frame)
 * - Ultra-low CPU (pre-decoded nativeImage instances, paused cleanly on stop/quit)
 */

const fs = require("node:fs");
const path = require("node:path");

function loadTemplateFrame(nativeImage, filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        const buf = fs.readFileSync(filePath);
        const img = nativeImage.createFromBuffer(buf, { scaleFactor: 2.0 });
        if (img.isEmpty()) return null;
        if (process.platform === "darwin") img.setTemplateImage(true);
        return img;
    } catch {
        return null;
    }
}

function createTrayAnimator({ tray, nativeImage, framesDir, fallbackImage }) {
    const idleFrames = [];
    const syncFrames = [];
    const warnFrames = [];

    if (framesDir) {
        for (let i = 0; i < 6; i++) {
            const img = loadTemplateFrame(nativeImage, path.join(framesDir, `tray-idle-${i}.png`));
            if (img) idleFrames.push(img);
        }
        for (let i = 0; i < 8; i++) {
            const img = loadTemplateFrame(nativeImage, path.join(framesDir, `tray-sync-${i}.png`));
            if (img) syncFrames.push(img);
        }
        for (let i = 0; i < 2; i++) {
            const img = loadTemplateFrame(nativeImage, path.join(framesDir, `tray-warn-${i}.png`));
            if (img) warnFrames.push(img);
        }
    }

    let mode = "";
    let index = 0;
    let timer = null;

    function stop() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    function applyFrame(list) {
        if (!tray || tray.isDestroyed?.()) {
            stop();
            return;
        }
        if (!list.length) {
            if (fallbackImage) tray.setImage(fallbackImage);
            return;
        }
        tray.setImage(list[index % list.length]);
        index = (index + 1) % list.length;
    }

    function setMode(nextMode) {
        const normalized = nextMode === "syncing" ? "syncing"
            : nextMode === "warn" ? "warn"
            : nextMode === "idle" ? "idle"
            : "static";
        if (normalized === mode) return;
        mode = normalized;
        stop();
        index = 0;

        if (mode === "syncing" && syncFrames.length) {
            applyFrame(syncFrames);
            timer = setInterval(() => applyFrame(syncFrames), 110);
            timer.unref?.();
        } else if (mode === "warn" && warnFrames.length) {
            applyFrame(warnFrames);
            timer = setInterval(() => applyFrame(warnFrames), 850);
            timer.unref?.();
        } else if (mode === "idle" && idleFrames.length) {
            applyFrame(idleFrames);
            timer = setInterval(() => applyFrame(idleFrames), 780);
            timer.unref?.();
        } else if (fallbackImage && tray && !tray.isDestroyed?.()) {
            tray.setImage(fallbackImage);
        }
    }

    return {
        setMode,
        stop,
        frameCounts: { idle: idleFrames.length, sync: syncFrames.length, warn: warnFrames.length },
    };
}

module.exports = { createTrayAnimator };
