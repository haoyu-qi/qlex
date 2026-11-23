"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalStore = exports.DEFAULT_APPEARANCE = exports.DEFAULT_SKILL_NAMESPACES = void 0;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");

const DEFAULT_APPEARANCE = Object.freeze({
    themePreset: "default",
    systemGlass: true,
    macBackdrop: "vibrancy",
    glassOpacity: 68,
    macGlassTint: 0,
    macClearGlassTint: 35,
    alwaysOnTop: false,
    dashboardFlat: false,
});

const DEFAULT_SKILL_NAMESPACES = Object.freeze(["agents", "codex", "claude", "hermes", "antigravity", "dsh"]);
const VALID_THEMES = new Set(["default", "obsidian", "porcelain"]);
const VALID_BACKDROPS = new Set(["vibrancy", "liquid-glass", "liquid-glass-clear"]);
const VALID_DOCK_MODES = new Set(["autoHide", "always"]);

function clamp(value, min, max, fallback) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.max(min, Math.min(max, Math.round(num))) : fallback;
}

function normalizeAppearance(raw) {
    const input = raw && typeof raw === "object" ? raw : {};
    return {
        themePreset: VALID_THEMES.has(input.themePreset) ? input.themePreset : DEFAULT_APPEARANCE.themePreset,
        systemGlass: typeof input.systemGlass === "boolean" ? input.systemGlass : DEFAULT_APPEARANCE.systemGlass,
        macBackdrop: VALID_BACKDROPS.has(input.macBackdrop) ? input.macBackdrop : DEFAULT_APPEARANCE.macBackdrop,
        glassOpacity: clamp(input.glassOpacity, 15, 100, DEFAULT_APPEARANCE.glassOpacity),
        macGlassTint: clamp(input.macGlassTint, 0, 100, DEFAULT_APPEARANCE.macGlassTint),
        macClearGlassTint: clamp(input.macClearGlassTint, 0, 100, DEFAULT_APPEARANCE.macClearGlassTint),
        alwaysOnTop: typeof input.alwaysOnTop === "boolean" ? input.alwaysOnTop : DEFAULT_APPEARANCE.alwaysOnTop,
        dashboardFlat: typeof input.dashboardFlat === "boolean" ? input.dashboardFlat : DEFAULT_APPEARANCE.dashboardFlat,
    };
}

function normalizeBounds(raw) {
    if (!raw || typeof raw !== "object") return undefined;
    const width = Number(raw.width);
    const height = Number(raw.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return undefined;
    const bounds = {
        width: Math.max(280, Math.min(1200, Math.round(width))),
        height: Math.max(380, Math.min(1400, Math.round(height))),
    };
    if (Number.isFinite(Number(raw.x)) && Number.isFinite(Number(raw.y))) {
        bounds.x = Math.round(Number(raw.x));
        bounds.y = Math.round(Number(raw.y));
    }
    return bounds;
}

function normalizeSkillNamespaces(raw) {
    if (!Array.isArray(raw)) return [...DEFAULT_SKILL_NAMESPACES];
    const valid = raw.filter(ns => DEFAULT_SKILL_NAMESPACES.includes(ns));
    return valid.length ? [...new Set(valid)] : [...DEFAULT_SKILL_NAMESPACES];
}

function defaultMemoryDir() {
    return (0, node_path_1.join)((0, node_os_1.homedir)(), "Documents", "QLEX-Memory");
}

const defaultState = () => ({
    version: 1,
    deviceId: (0, node_crypto_1.randomUUID)(),
    configured: false,
    keepRunning: true,
    edgeDock: "off",
    edgeDockMode: "autoHide",
    skillSyncEnabled: true,
    localSkillNamespaces: [...DEFAULT_SKILL_NAMESPACES],
    memoryArchiveDir: defaultMemoryDir(),
    memoryAutoCompress: true,
    projects: [],
    appearance: { ...DEFAULT_APPEARANCE },
});

class LocalStore {
    file;
    state;
    constructor(file) {
        this.file = file;
        try {
            const value = JSON.parse((0, node_fs_1.readFileSync)(file, "utf8"));
            if (!value || value.version !== 1 || typeof value.deviceId !== "string" ||
                typeof value.configured !== "boolean" || typeof value.keepRunning !== "boolean" ||
                !Array.isArray(value.projects) || value.projects.some((project) => !project || typeof project.id !== "string" || typeof project.name !== "string" ||
                typeof project.directory !== "string")) {
                throw new Error("Unsupported QLEX local settings");
            }
            this.state = {
                ...value,
                edgeDock: ["off", "left", "right"].includes(value.edgeDock) ? value.edgeDock : "off",
                edgeDockMode: VALID_DOCK_MODES.has(value.edgeDockMode) ? value.edgeDockMode : "autoHide",
                localSkillNamespaces: normalizeSkillNamespaces(value.localSkillNamespaces),
                memoryArchiveDir: typeof value.memoryArchiveDir === "string" && value.memoryArchiveDir.trim()
                    ? value.memoryArchiveDir.trim()
                    : defaultMemoryDir(),
                memoryAutoCompress: typeof value.memoryAutoCompress === "boolean" ? value.memoryAutoCompress : true,
                appearance: normalizeAppearance(value.appearance),
                ...(normalizeBounds(value.windowBounds) ? { windowBounds: normalizeBounds(value.windowBounds) } : {}),
            };
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
            this.state = defaultState();
            this.save(this.state);
        }
    }
    snapshot() {
        return structuredClone(this.state);
    }
    configure() {
        return this.update({ configured: true });
    }
    setKeepRunning(keepRunning) {
        return this.update({ keepRunning });
    }
    setPairing(pairing) {
        return this.update({ pairing, configured: this.state.configured || pairing.mode !== "local" });
    }
    setAppearance(patch) {
        const next = normalizeAppearance({ ...this.state.appearance, ...(patch && typeof patch === "object" ? patch : {}) });
        return this.update({ appearance: next });
    }
    setWindowBounds(bounds) {
        const normalized = normalizeBounds(bounds);
        if (!normalized) return this.snapshot();
        return this.update({ windowBounds: normalized });
    }
    addProject(directory) {
        const normalized = (0, node_path_1.resolve)(directory);
        if (!(0, node_path_1.basename)(normalized))
            throw new Error("请选择一个项目目录，文件系统根目录不能绑定为项目。");
        if (this.state.projects.some((project) => project.directory === normalized)) {
            return this.snapshot();
        }
        const project = { id: (0, node_crypto_1.randomUUID)(), name: (0, node_path_1.basename)(normalized), directory: normalized };
        return this.update({ projects: [...this.state.projects, project] });
    }
    setEdgeDock(side) {
        if (!["off", "left", "right"].includes(side))
            throw new Error("无效的侧边吸附位置。");
        return this.update({ edgeDock: side });
    }
    setEdgeDockMode(mode) {
        if (!VALID_DOCK_MODES.has(mode))
            throw new Error("无效的侧边吸附显示模式。");
        return this.update({ edgeDockMode: mode });
    }
    setSkillSync(enabled) {
        if (typeof enabled !== "boolean") throw new Error("无效的 Skills 同步设置。");
        return this.update({ skillSyncEnabled: enabled });
    }
    setLocalSkillNamespaces(namespaces) {
        return this.update({ localSkillNamespaces: normalizeSkillNamespaces(namespaces) });
    }
    setMemoryArchiveDir(dir) {
        if (typeof dir !== "string" || !dir.trim()) throw new Error("无效的记忆归档目录。");
        const normalized = (0, node_path_1.resolve)(dir.trim());
        if (!(0, node_path_1.basename)(normalized)) throw new Error("请选择有效的文件夹路径。");
        return this.update({ memoryArchiveDir: normalized });
    }
    setMemoryAutoCompress(enabled) {
        if (typeof enabled !== "boolean") throw new Error("无效的记忆自动压缩设置。");
        return this.update({ memoryAutoCompress: enabled });
    }
    projectById(id) {
        const project = typeof id === "string" && this.state.projects.find((entry) => entry.id === id);
        if (!project)
            throw new Error("这个项目已移出列表。");
        return { ...project };
    }
    renameProject(id, name) {
        const project = this.projectById(id);
        const normalized = typeof name === "string" ? name.trim() : "";
        if (!normalized || normalized.length > 120)
            throw new Error("请输入 1 至 120 个字符的项目名称。");
        return this.update({
            projects: this.state.projects.map((entry) =>
                entry.id === project.id ? { ...entry, name: normalized } : entry),
        });
    }
    removeProject(id) {
        const project = this.projectById(id);
        return this.update({
            projects: this.state.projects.filter((entry) => entry.id !== project.id),
        });
    }
    update(changes) {
        const next = { ...this.state, ...changes };
        this.save(next);
        this.state = next;
        return this.snapshot();
    }
    save(next) {
        (0, node_fs_1.mkdirSync)((0, node_path_1.dirname)(this.file), { recursive: true, mode: 0o700 });
        const temporary = `${this.file}.${(0, node_crypto_1.randomUUID)()}.tmp`;
        try {
            (0, node_fs_1.writeFileSync)(temporary, JSON.stringify(next, null, 2) + "\n", { mode: 0o600, flag: "wx" });
            (0, node_fs_1.renameSync)(temporary, this.file);
        }
        catch (error) {
            try {
                (0, node_fs_1.unlinkSync)(temporary);
            }
            catch { /* Preserve the original write error. */ }
            throw error;
        }
    }
}
exports.LocalStore = LocalStore;
exports.DEFAULT_APPEARANCE = DEFAULT_APPEARANCE;
exports.DEFAULT_SKILL_NAMESPACES = DEFAULT_SKILL_NAMESPACES;
