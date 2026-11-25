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
    openMainPage: (page) => electron_1.ipcRenderer.invoke("qlex:open-main-page", page),
    closeMenubarPopover: () => electron_1.ipcRenderer.invoke("qlex:close-menubar-popover"),
    resizeMenubarPopover: (height) => electron_1.ipcRenderer.invoke("qlex:resize-menubar-popover", height),
    onMenubarShown: (fn) => electron_1.ipcRenderer.on("qlex:menubar-shown", () => fn()),
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

    // Usage, quotas & collector diagnostics
    refreshUsage: () => electron_1.ipcRenderer.invoke("qlex:refresh-usage"),
    usagePeriod: (days) => electron_1.ipcRenderer.invoke("qlex:usage-period", days),
    setCollectorPath: (source, dir) => electron_1.ipcRenderer.invoke("qlex:set-collector-path", { source, dir }),

    // Tailscale SDK & Auto-Discovery
    tailscaleScan: () => electron_1.ipcRenderer.invoke("qlex:tailscale-scan"),
    tailscaleStartEmbedded: (input) => electron_1.ipcRenderer.invoke("qlex:tailscale-start-embedded", input),
    tailscaleStopEmbedded: () => electron_1.ipcRenderer.invoke("qlex:tailscale-stop-embedded"),
    tailscaleOpenAuth: () => electron_1.ipcRenderer.invoke("qlex:tailscale-open-auth"),

    // Version Download & Update Push Channel
    updateCheck: (force) => electron_1.ipcRenderer.invoke("qlex:update-check", force),
    updateDownload: () => electron_1.ipcRenderer.invoke("qlex:update-download"),
    updateInstall: () => electron_1.ipcRenderer.invoke("qlex:update-install"),
    updateOpenRelease: () => electron_1.ipcRenderer.invoke("qlex:update-open-release"),
    setUpdateChannel: (channel) => electron_1.ipcRenderer.invoke("qlex:set-update-channel", channel),
    setAutoUpdates: (enabled) => electron_1.ipcRenderer.invoke("qlex:set-auto-updates", enabled),

    // Skills sync (local multi-tool + center/endpoint + conflict resolution)
    setSkillSync: (enabled) => electron_1.ipcRenderer.invoke("qlex:set-skill-sync", enabled),
    setSkillNamespaces: (namespaces) => electron_1.ipcRenderer.invoke("qlex:set-skill-namespaces", namespaces),
    setSkillSyncPolicy: (patch) => electron_1.ipcRenderer.invoke("qlex:set-skill-sync-policy", patch),
    toggleSkillExcluded: (name, excluded) => electron_1.ipcRenderer.invoke("qlex:toggle-skill-excluded", { name, excluded }),
    syncLocalSkills: () => electron_1.ipcRenderer.invoke("qlex:sync-local-skills"),
    resolveSkillConflict: (name, sourceNs) => electron_1.ipcRenderer.invoke("qlex:resolve-skill-conflict", { name, sourceNs }),
    resolveAllSkillConflicts: (strategy) => electron_1.ipcRenderer.invoke("qlex:resolve-all-skill-conflicts", strategy),
    repairSkillAnomalies: () => electron_1.ipcRenderer.invoke("qlex:repair-skill-anomalies"),
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
    copyInvite: () => electron_1.ipcRenderer.invoke("qlex:copy-invite"),
    approveDevice: (id) => electron_1.ipcRenderer.invoke("qlex:approve-device", id),
    removeDevice: (id) => electron_1.ipcRenderer.invoke("qlex:remove-device", id),

    // Projects & cross-device project sync
    chooseProject: () => electron_1.ipcRenderer.invoke("qlex:choose-project"),
    chooseProjectSyncDir: () => electron_1.ipcRenderer.invoke("qlex:choose-project-sync-dir"),
    openProjectSyncDir: () => electron_1.ipcRenderer.invoke("qlex:open-project-sync-dir"),
    setAutoSaveProjects: (enabled) => electron_1.ipcRenderer.invoke("qlex:set-auto-save-projects", enabled),
    bindRemoteProject: (syncId, directory) => electron_1.ipcRenderer.invoke("qlex:bind-remote-project", directory ? { syncId, directory } : syncId),
    syncMemoryNow: () => electron_1.ipcRenderer.invoke("qlex:sync-memory-now"),
    syncProjectsNow: () => electron_1.ipcRenderer.invoke("qlex:sync-projects-now"),
    addDiscoveredProject: (directory) => electron_1.ipcRenderer.invoke("qlex:add-discovered-project", directory),
    openDiscoveredProject: (directory) => electron_1.ipcRenderer.invoke("qlex:open-discovered-project", directory),
    openProject: (id) => electron_1.ipcRenderer.invoke("qlex:open-project", id),
    renameProject: (id, name) => electron_1.ipcRenderer.invoke("qlex:rename-project", { id, name }),
    removeProject: (id) => electron_1.ipcRenderer.invoke("qlex:remove-project", id),
    setKeepRunning: (enabled) => electron_1.ipcRenderer.invoke("qlex:keep-running", enabled),
});
