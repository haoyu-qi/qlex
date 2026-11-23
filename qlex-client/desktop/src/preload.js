"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");

electron_1.contextBridge.exposeInMainWorld("qlex", {
    // Core state & navigation
    getState: () => electron_1.ipcRenderer.invoke("qlex:state"),
    onNavigate: (fn) => electron_1.ipcRenderer.on("qlex:navigate", (_, page) => fn(page)),
    onStateChanged: (fn) => electron_1.ipcRenderer.on("qlex:state-changed", (_, next) => fn(next)),

    // Unified sync button with live status
    syncNow: () => electron_1.ipcRenderer.invoke("qlex:sync-now"),

    // Appearance & native glass material
    updateAppearance: (patch) => electron_1.ipcRenderer.invoke("qlex:update-appearance", patch),
    getNativeMaterial: () => electron_1.ipcRenderer.invoke("qlex:native-material"),
    onNativeMaterial: (fn) => electron_1.ipcRenderer.on("appearance:nativeMaterial", (_, state) => fn(state)),

    // Window controls (frameless native glass chrome)
    minimizeWindow: () => electron_1.ipcRenderer.invoke("qlex:window-minimize"),
    closeWindow: () => electron_1.ipcRenderer.invoke("qlex:window-close"),
    togglePinWindow: () => electron_1.ipcRenderer.invoke("qlex:window-toggle-pin"),
    openDashboard: (tab) => electron_1.ipcRenderer.invoke("qlex:open-dashboard", tab),
    onDashboardTab: (fn) => electron_1.ipcRenderer.on("qlex:dashboard-tab", (_, tab) => fn(tab)),

    // Edge Dock (hover-to-reveal autoHide / always)
    setEdgeDock: (side) => electron_1.ipcRenderer.invoke("qlex:set-edge-dock", side),
    setEdgeDockMode: (mode) => electron_1.ipcRenderer.invoke("qlex:set-edge-dock-mode", mode),
    dockState: () => electron_1.ipcRenderer.invoke("qlex:dock-state"),
    dockPin: (item) => electron_1.ipcRenderer.invoke("qlex:dock-pin", item),
    dockDismiss: () => electron_1.ipcRenderer.invoke("qlex:dock-dismiss"),
    dockSyncNow: () => electron_1.ipcRenderer.invoke("qlex:dock-sync"),
    dockCompressMemory: () => electron_1.ipcRenderer.invoke("qlex:dock-compress-memory"),
    onDockPresentation: (handler) => electron_1.ipcRenderer.on("qlex:dock-presentation", (_, value) => handler(value)),
    dockOpen: (page) => electron_1.ipcRenderer.invoke("qlex:dock-open", page),

    // Usage & quotas
    refreshUsage: () => electron_1.ipcRenderer.invoke("qlex:refresh-usage"),
    usagePeriod: (days) => electron_1.ipcRenderer.invoke("qlex:usage-period", days),

    // Skills sync (local multi-tool + center/endpoint + conflict resolution)
    setSkillSync: (enabled) => electron_1.ipcRenderer.invoke("qlex:set-skill-sync", enabled),
    setSkillNamespaces: (namespaces) => electron_1.ipcRenderer.invoke("qlex:set-skill-namespaces", namespaces),
    syncLocalSkills: () => electron_1.ipcRenderer.invoke("qlex:sync-local-skills"),
    resolveSkillConflict: (name, sourceNs) => electron_1.ipcRenderer.invoke("qlex:resolve-skill-conflict", { name, sourceNs }),
    resolveAllSkillConflicts: (strategy) => electron_1.ipcRenderer.invoke("qlex:resolve-all-skill-conflicts", strategy),
    openSkillBackupDir: () => electron_1.ipcRenderer.invoke("qlex:open-skill-backup-dir"),
    openSkillDir: (namespace) => electron_1.ipcRenderer.invoke("qlex:open-skill-dir", namespace),

    // Cognitive memory engine (Mem0 / Hindsight / memU / Cognee / Graphiti / OpenViking + Daily/Weekly/Monthly)
    compressMemory: () => electron_1.ipcRenderer.invoke("qlex:compress-memory"),
    readMemoryArchive: (kind, key) => electron_1.ipcRenderer.invoke("qlex:read-memory-archive", { kind, key }),
    memoryRecall: (input) => electron_1.ipcRenderer.invoke("qlex:memory-recall", input),
    memoryRetain: (input) => electron_1.ipcRenderer.invoke("qlex:memory-retain", input),
    memoryReflect: (input) => electron_1.ipcRenderer.invoke("qlex:memory-reflect", input),
    memoryGraph: (input) => electron_1.ipcRenderer.invoke("qlex:memory-graph", input),
    memoryBrowse: (input) => electron_1.ipcRenderer.invoke("qlex:memory-browse", input),
    memoryForget: (input) => electron_1.ipcRenderer.invoke("qlex:memory-forget", input),
    installMemorySkill: () => electron_1.ipcRenderer.invoke("qlex:install-memory-skill"),
    memorySkillStatus: () => electron_1.ipcRenderer.invoke("qlex:memory-skill-status"),
    chooseMemoryDir: () => electron_1.ipcRenderer.invoke("qlex:choose-memory-dir"),
    openMemoryDir: () => electron_1.ipcRenderer.invoke("qlex:open-memory-dir"),
    openMemoryFile: (kind, key) => electron_1.ipcRenderer.invoke("qlex:open-memory-file", { kind, key }),
    setMemoryAutoCompress: (enabled) => electron_1.ipcRenderer.invoke("qlex:set-memory-auto", enabled),

    // Pairing & device roles
    configureLocal: () => electron_1.ipcRenderer.invoke("qlex:configure-local"),
    enableCenter: () => electron_1.ipcRenderer.invoke("qlex:enable-center"),
    joinCenter: (code) => electron_1.ipcRenderer.invoke("qlex:join-center", code),
    useLocal: () => electron_1.ipcRenderer.invoke("qlex:use-local"),
    refreshPairing: () => electron_1.ipcRenderer.invoke("qlex:refresh-pairing"),
    createInvite: (host) => electron_1.ipcRenderer.invoke("qlex:create-invite", host),
    approveDevice: (id) => electron_1.ipcRenderer.invoke("qlex:approve-device", id),
    removeDevice: (id) => electron_1.ipcRenderer.invoke("qlex:remove-device", id),

    // Projects
    chooseProject: () => electron_1.ipcRenderer.invoke("qlex:choose-project"),
    addDiscoveredProject: (directory) => electron_1.ipcRenderer.invoke("qlex:add-discovered-project", directory),
    openDiscoveredProject: (directory) => electron_1.ipcRenderer.invoke("qlex:open-discovered-project", directory),
    openProject: (id) => electron_1.ipcRenderer.invoke("qlex:open-project", id),
    renameProject: (id, name) => electron_1.ipcRenderer.invoke("qlex:rename-project", { id, name }),
    removeProject: (id) => electron_1.ipcRenderer.invoke("qlex:remove-project", id),
    setKeepRunning: (enabled) => electron_1.ipcRenderer.invoke("qlex:keep-running", enabled),
});
