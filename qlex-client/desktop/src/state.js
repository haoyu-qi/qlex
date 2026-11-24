"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalStore = exports.DEFAULT_APPEARANCE = exports.DEFAULT_SKILL_NAMESPACES = void 0;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const { inspectWorkspace, applyWorkspaceContext } = require("./project-sync");

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

const DEFAULT_SKILL_NAMESPACES = Object.freeze(["agents", "codex", "claude", "hermes", "antigravity", "dsh", "workbuddy", "zcode", "t3code"]);
const VALID_THEMES = new Set(["default", "obsidian", "porcelain"]);
const VALID_BACKDROPS = new Set(["vibrancy", "liquid-glass", "liquid-glass-clear"]);
const VALID_DOCK_MODES = new Set(["autoHide", "always"]);
const VALID_UPDATE_CHANNELS = new Set(["beta", "stable"]);

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
        width: Math.max(280, Math.min(1800, Math.round(width))),
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

function projectSyncSlug(name) {
    return String(name || "project").trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "project";
}

function normalizeSyncedDevices(list) {
    if (!Array.isArray(list)) return [];
    const map = new Map();
    for (const d of list) {
        if (!d || typeof d.name !== "string" || !d.name.trim()) continue;
        const key = d.name.trim().slice(0, 100);
        const prev = map.get(key);
        const ts = Number.isFinite(Number(d.updatedAt)) ? Number(d.updatedAt) : Date.now();
        if (!prev || ts >= prev.updatedAt) {
            map.set(key, {
                name: key,
                gitBranch: typeof d.gitBranch === "string" ? d.gitBranch.slice(0, 80) : "",
                gitCommit: typeof d.gitCommit === "string" ? d.gitCommit.slice(0, 16) : "",
                updatedAt: ts,
            });
        }
    }
    return [...map.values()].slice(0, 20);
}

function normalizeProjects(list) {
    if (!Array.isArray(list)) return [];
    return list.map(p => ({
        ...p,
        syncId: typeof p.syncId === "string" && p.syncId.trim() ? p.syncId.trim() : `proj_${projectSyncSlug(p.name)}`,
        shared: typeof p.shared === "boolean" ? p.shared : true,
        updatedAt: Number.isFinite(Number(p.updatedAt)) ? Number(p.updatedAt) : Date.now(),
        gitRemote: typeof p.gitRemote === "string" ? p.gitRemote.slice(0, 300) : "",
        gitBranch: typeof p.gitBranch === "string" ? p.gitBranch.slice(0, 80) : "",
        gitCommit: typeof p.gitCommit === "string" ? p.gitCommit.slice(0, 16) : "",
        contextHash: typeof p.contextHash === "string" ? p.contextHash.slice(0, 32) : "",
        contextFilesCount: Number.isFinite(Number(p.contextFilesCount)) ? Number(p.contextFilesCount) : 0,
        syncedDevices: normalizeSyncedDevices(p.syncedDevices),
        lastSyncedAt: Number.isFinite(Number(p.lastSyncedAt)) ? Number(p.lastSyncedAt) : 0,
    }));
}

function normalizeRemoteProjects(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(p => p && typeof p.syncId === "string" && typeof p.name === "string").map(p => ({
        syncId: p.syncId.trim(),
        name: p.name.trim().slice(0, 120),
        originDevice: typeof p.originDevice === "string" ? p.originDevice.slice(0, 100) : "",
        updatedAt: Number.isFinite(Number(p.updatedAt)) ? Number(p.updatedAt) : Date.now(),
        gitRemote: typeof p.gitRemote === "string" ? p.gitRemote.slice(0, 300) : "",
        gitBranch: typeof p.gitBranch === "string" ? p.gitBranch.slice(0, 80) : "",
        gitCommit: typeof p.gitCommit === "string" ? p.gitCommit.slice(0, 16) : "",
        contextHash: typeof p.contextHash === "string" ? p.contextHash.slice(0, 32) : "",
        contextFiles: Array.isArray(p.contextFiles) ? p.contextFiles : [],
        syncedDevices: normalizeSyncedDevices(p.syncedDevices),
    }));
}

function normalizeDeletedProjects(list) {
    if (!Array.isArray(list)) return [];
    const map = new Map();
    for (const d of list) {
        if (!d || typeof d.syncId !== "string" || !d.syncId.trim()) continue;
        const syncId = d.syncId.trim();
        const deletedAt = Number.isFinite(Number(d.deletedAt)) ? Number(d.deletedAt) : Date.now();
        const prev = map.get(syncId);
        if (!prev || deletedAt > prev.deletedAt) {
            map.set(syncId, {
                syncId,
                deletedAt,
                originDevice: typeof d.originDevice === "string" ? d.originDevice.slice(0, 100) : "",
            });
        }
    }
    return [...map.values()].slice(-200);
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
    updateChannel: "beta",
    autoCheckUpdates: true,
    collectorPaths: {},
    projects: [],
    remoteProjects: [],
    deletedProjects: [],
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
                updateChannel: VALID_UPDATE_CHANNELS.has(value.updateChannel) ? value.updateChannel : "beta",
                autoCheckUpdates: typeof value.autoCheckUpdates === "boolean" ? value.autoCheckUpdates : true,
                collectorPaths: value.collectorPaths && typeof value.collectorPaths === "object" && !Array.isArray(value.collectorPaths) ? value.collectorPaths : {},
                projects: normalizeProjects(value.projects),
                remoteProjects: normalizeRemoteProjects(value.remoteProjects),
                deletedProjects: normalizeDeletedProjects(value.deletedProjects),
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
    addProject(directory, syncId = "") {
        const normalized = (0, node_path_1.resolve)(directory);
        if (!(0, node_path_1.basename)(normalized))
            throw new Error("请选择一个项目目录，文件系统根目录不能绑定为项目。");
        if (this.state.projects.some((project) => project.directory === normalized)) {
            return this.snapshot();
        }
        const name = (0, node_path_1.basename)(normalized);
        const resolvedSyncId = syncId || `proj_${projectSyncSlug(name)}`;
        const meta = inspectWorkspace(normalized, { includeContent: false });
        const selfName = (0, node_os_1.hostname)();
        const now = Date.now();
        const project = {
            id: (0, node_crypto_1.randomUUID)(),
            syncId: resolvedSyncId,
            name,
            directory: normalized,
            shared: true,
            updatedAt: now,
            gitRemote: meta.gitRemote,
            gitBranch: meta.gitBranch,
            gitCommit: meta.gitCommit,
            contextHash: meta.contextHash,
            contextFilesCount: meta.contextFiles.length,
            syncedDevices: [{ name: selfName, gitBranch: meta.gitBranch, gitCommit: meta.gitCommit, updatedAt: now }],
            lastSyncedAt: 0,
        };
        const remoteProjects = (this.state.remoteProjects || []).filter(r => r.syncId !== resolvedSyncId);
        const deletedProjects = (this.state.deletedProjects || []).filter(d => d.syncId !== resolvedSyncId);
        return this.update({ projects: [...this.state.projects, project], remoteProjects, deletedProjects });
    }
    refreshLocalProjectsMetadata(originDevice = (0, node_os_1.hostname)()) {
        const projects = (this.state.projects || []).map(p => {
            const meta = inspectWorkspace(p.directory, { includeContent: false });
            if (!meta.exists) return p;
            const devices = normalizeSyncedDevices([
                ...(p.syncedDevices || []),
                { name: originDevice, gitBranch: meta.gitBranch, gitCommit: meta.gitCommit, updatedAt: Date.now() },
            ]);
            return {
                ...p,
                gitRemote: meta.gitRemote || p.gitRemote || "",
                gitBranch: meta.gitBranch || p.gitBranch || "",
                gitCommit: meta.gitCommit || p.gitCommit || "",
                contextHash: meta.contextHash || "",
                contextFilesCount: meta.contextFiles.length,
                syncedDevices: devices,
            };
        });
        return this.update({ projects });
    }
    exportSharedProjects(originDevice = (0, node_os_1.hostname)(), { includeContext = true } = {}) {
        const map = new Map();
        for (const r of this.state.remoteProjects || []) {
            map.set(r.syncId, {
                syncId: r.syncId,
                name: r.name,
                originDevice: r.originDevice || originDevice,
                updatedAt: r.updatedAt || Date.now(),
                gitRemote: r.gitRemote || "",
                gitBranch: r.gitBranch || "",
                gitCommit: r.gitCommit || "",
                contextHash: r.contextHash || "",
                contextFiles: includeContext ? (r.contextFiles || []) : [],
                syncedDevices: normalizeSyncedDevices(r.syncedDevices),
            });
        }
        for (const p of this.state.projects || []) {
            if (p.shared === false) continue;
            const meta = inspectWorkspace(p.directory, { includeContent: includeContext });
            const syncedDevices = normalizeSyncedDevices([
                ...(p.syncedDevices || []),
                { name: originDevice, gitBranch: meta.gitBranch || p.gitBranch || "", gitCommit: meta.gitCommit || p.gitCommit || "", updatedAt: Date.now() },
            ]);
            map.set(p.syncId, {
                syncId: p.syncId,
                name: p.name,
                originDevice,
                updatedAt: p.updatedAt || Date.now(),
                gitRemote: meta.gitRemote || p.gitRemote || "",
                gitBranch: meta.gitBranch || p.gitBranch || "",
                gitCommit: meta.gitCommit || p.gitCommit || "",
                contextHash: meta.contextHash || p.contextHash || "",
                contextFiles: includeContext ? meta.contextFiles : [],
                syncedDevices,
            });
        }
        return {
            projects: [...map.values()],
            deleted: normalizeDeletedProjects(this.state.deletedProjects),
        };
    }
    mergeSharedProjects(incomingPayload = [], { peerName = "", applyContext = true, backupRoot } = {}) {
        // Accept both new { projects, deleted } envelope and legacy [...] array
        const incomingList = Array.isArray(incomingPayload)
            ? incomingPayload
            : (Array.isArray(incomingPayload?.projects) ? incomingPayload.projects : []);
        const incomingDeleted = Array.isArray(incomingPayload?.deleted)
            ? normalizeDeletedProjects(incomingPayload.deleted)
            : [];

        const localBySync = new Map((this.state.projects || []).map(p => [p.syncId, { ...p }]));
        const remoteBySync = new Map((this.state.remoteProjects || []).map(r => [r.syncId, { ...r }]));
        const deletedBySync = new Map(normalizeDeletedProjects(this.state.deletedProjects).map(d => [d.syncId, d]));

        let added = 0;
        let updated = 0;
        let removed = 0;
        let contextApplied = 0;
        const now = Date.now();

        // 1. Merge incoming deletion tombstones
        for (const del of incomingDeleted) {
            const prevDel = deletedBySync.get(del.syncId);
            if (!prevDel || del.deletedAt > prevDel.deletedAt) {
                deletedBySync.set(del.syncId, del);
            }
            const curRemote = remoteBySync.get(del.syncId);
            if (curRemote && del.deletedAt >= (curRemote.updatedAt || 0)) {
                remoteBySync.delete(del.syncId);
                removed++;
            }
            const curLocal = localBySync.get(del.syncId);
            if (curLocal && del.deletedAt > (curLocal.updatedAt || 0)) {
                localBySync.delete(del.syncId);
                removed++;
            }
        }

        // 2. Merge incoming shared projects (respecting newer tombstones)
        for (const inc of normalizeRemoteProjects(incomingList)) {
            const tomb = deletedBySync.get(inc.syncId);
            if (tomb && tomb.deletedAt >= (inc.updatedAt || 0)) {
                continue;
            }
            if (tomb && (inc.updatedAt || 0) > tomb.deletedAt) {
                deletedBySync.delete(inc.syncId);
            }

            const peerDeviceEntries = normalizeSyncedDevices([
                ...(inc.syncedDevices || []),
                ...(inc.originDevice ? [{ name: inc.originDevice, gitBranch: inc.gitBranch, gitCommit: inc.gitCommit, updatedAt: inc.updatedAt }] : []),
                ...(peerName ? [{ name: peerName, gitBranch: inc.gitBranch, gitCommit: inc.gitCommit, updatedAt: now }] : []),
            ]);

            const local = localBySync.get(inc.syncId);
            if (local) {
                let changed = false;
                if (inc.updatedAt > (local.updatedAt || 0) && inc.name !== local.name) {
                    local.name = inc.name;
                    local.updatedAt = inc.updatedAt;
                    changed = true;
                }
                if (inc.gitRemote && !local.gitRemote) {
                    local.gitRemote = inc.gitRemote;
                    changed = true;
                }
                const mergedDevices = normalizeSyncedDevices([...(local.syncedDevices || []), ...peerDeviceEntries]);
                local.syncedDevices = mergedDevices;
                local.lastSyncedAt = now;

                // Apply newer workspace AI context files (AGENTS.md / CLAUDE.md / .cursorrules / .qlex-context.md) with automatic backup
                if (applyContext && Array.isArray(inc.contextFiles) && inc.contextFiles.length) {
                    const ctxRes = applyWorkspaceContext(local.directory, inc.contextFiles, local.syncId, backupRoot);
                    if (ctxRes.applied > 0) {
                        contextApplied += ctxRes.applied;
                        const refreshed = inspectWorkspace(local.directory, { includeContent: false });
                        local.contextHash = refreshed.contextHash;
                        local.contextFilesCount = refreshed.contextFiles.length;
                        changed = true;
                    }
                }
                if (changed) updated++;
                remoteBySync.delete(inc.syncId);
                continue;
            }

            const cur = remoteBySync.get(inc.syncId);
            const enrichedRemote = {
                ...inc,
                syncedDevices: normalizeSyncedDevices([...(cur?.syncedDevices || []), ...peerDeviceEntries]),
            };
            if (!cur) {
                remoteBySync.set(inc.syncId, enrichedRemote);
                added++;
            } else if (inc.updatedAt > (cur.updatedAt || 0) || inc.contextHash !== cur.contextHash || inc.gitBranch !== cur.gitBranch || inc.gitRemote !== cur.gitRemote) {
                remoteBySync.set(inc.syncId, enrichedRemote);
                updated++;
            } else {
                remoteBySync.set(inc.syncId, enrichedRemote);
            }
        }

        // Persist lightweight remoteProjects (retain contextFiles up to 64KB per file so binding immediately applies them)
        this.update({
            projects: [...localBySync.values()],
            remoteProjects: [...remoteBySync.values()],
            deletedProjects: [...deletedBySync.values()].slice(-200),
        });
        return {
            added,
            updated,
            removed,
            contextApplied,
            remotePending: remoteBySync.size,
            totalShared: localBySync.size + remoteBySync.size,
        };
    }
    bindRemoteProject(syncId, directory, { backupRoot } = {}) {
        const remote = (this.state.remoteProjects || []).find(r => r.syncId === syncId);
        if (!remote) throw new Error("该远端共享项目已不存在或已完成绑定。");
        let next = this.addProject(directory, remote.syncId);
        // Apply any carried workspace AI context files from the remote project safely
        if (Array.isArray(remote.contextFiles) && remote.contextFiles.length) {
            applyWorkspaceContext((0, node_path_1.resolve)(directory), remote.contextFiles, remote.syncId, backupRoot);
        }
        const refreshedMeta = inspectWorkspace((0, node_path_1.resolve)(directory), { includeContent: false });
        const selfName = (0, node_os_1.hostname)();
        const now = Date.now();
        const projects = next.projects.map(p => {
            if (p.syncId !== remote.syncId) return p;
            return {
                ...p,
                name: remote.name || p.name,
                gitRemote: refreshedMeta.gitRemote || remote.gitRemote || p.gitRemote || "",
                gitBranch: refreshedMeta.gitBranch || p.gitBranch || "",
                gitCommit: refreshedMeta.gitCommit || p.gitCommit || "",
                contextHash: refreshedMeta.contextHash || "",
                contextFilesCount: refreshedMeta.contextFiles.length,
                syncedDevices: normalizeSyncedDevices([
                    ...(remote.syncedDevices || []),
                    ...(p.syncedDevices || []),
                    { name: selfName, gitBranch: refreshedMeta.gitBranch, gitCommit: refreshedMeta.gitCommit, updatedAt: now },
                ]),
                lastSyncedAt: now,
                updatedAt: Math.max(now, remote.updatedAt || 0),
            };
        });
        return this.update({ projects });
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
    setUpdateChannel(channel) {
        if (!VALID_UPDATE_CHANNELS.has(channel)) throw new Error("无效的更新通道设置。");
        return this.update({ updateChannel: channel });
    }
    setAutoCheckUpdates(enabled) {
        if (typeof enabled !== "boolean") throw new Error("无效的自动更新检查设置。");
        return this.update({ autoCheckUpdates: enabled });
    }
    setCollectorPath(source, dir) {
        if (!["codex", "claude", "antigravity", "hermes", "dsh", "workbuddy", "zcode", "t3code"].includes(source)) throw new Error("未知的采集源。");
        const next = { ...(this.state.collectorPaths || {}) };
        if (!dir || !String(dir).trim()) delete next[source];
        else next[source] = (0, node_path_1.resolve)(String(dir).trim());
        return this.update({ collectorPaths: next });
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
                entry.id === project.id ? { ...entry, name: normalized, updatedAt: Date.now() } : entry),
        });
    }
    removeProject(id) {
        const project = this.projectById(id);
        const deletedProjects = normalizeDeletedProjects([
            ...(this.state.deletedProjects || []),
            { syncId: project.syncId, deletedAt: Date.now(), originDevice: (0, node_os_1.hostname)() },
        ]);
        return this.update({
            projects: this.state.projects.filter((entry) => entry.id !== project.id),
            remoteProjects: (this.state.remoteProjects || []).filter((entry) => entry.syncId !== project.syncId),
            deletedProjects,
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
