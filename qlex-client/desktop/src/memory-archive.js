"use strict";

const fs = require("node:fs");
const { homedir } = require("node:os");
const { createCognitiveMemoryEngine, isoWeekKey } = require("./memory-core");

function readJsonSafe(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return fallback;
    }
}

function createMemoryArchiver({ getArchiveDir, getProjects, getUsageSnapshot, getTopicsByDate, getSessionEpisodes, home = homedir() }) {
    const engine = createCognitiveMemoryEngine({ getArchiveDir, getProjects, getUsageSnapshot, getTopicsByDate, getSessionEpisodes, home });
    let state = {
        phase: "idle",
        archiveDir: getArchiveDir(),
        lastRun: 0,
        rawBytes: 0,
        compressedBytes: 0,
        compressionRatio: 0,
        cacheHits: 0,
        cacheMisses: 0,
        counts: { daily: 0, weekly: 0, monthly: 0 },
        cognitive: {
            engineVersion: "3.0.0",
            activeItems: 0,
            supersededItems: 0,
            deletedItems: 0,
            totalItems: 0,
            entities: 0,
            activeEdges: 0,
            historicalEdges: 0,
            totalEdges: 0,
            banks: { world: 0, experience: 0, opinion: 0, observation: 0, mental_model: 0 },
            tiers: { working: 0, episodic: 0, semantic: 0, procedural: 0 },
            temperatures: { hot: 0, warm: 0, cold: 0, dormant: 0 },
            lessonsCount: 0,
            expiringSoon: 0,
            categories: {},
            reflectionsCount: 0,
        },
        items: { daily: [], weekly: [], monthly: [] },
        consolidation: null,
        error: null,
    };
    let running = null;
    let consolidating = null;

    function loadExistingIndex() {
        const p = engine.pathsOf();
        const saved = readJsonSafe(p.indexFile, null);
        const liveStatus = engine.getStatus();
        const consolidation = engine.getConsolidationStatus();
        state.archiveDir = p.root;
        state.cognitive = liveStatus.cognitive;
        state.consolidation = consolidation;
        if (saved && saved.items) {
            state = {
                ...state,
                archiveDir: p.root,
                lastRun: saved.lastRun || 0,
                rawBytes: saved.rawBytes || 0,
                compressedBytes: saved.compressedBytes || 0,
                compressionRatio: saved.compressionRatio || 0,
                cacheHits: saved.cacheHits || 0,
                cacheMisses: saved.cacheMisses || 0,
                counts: saved.counts || { daily: 0, weekly: 0, monthly: 0 },
                cognitive: liveStatus.cognitive,
                consolidation,
                items: saved.items,
            };
        }
    }

    async function consolidateNow(opts = {}) {
        if (consolidating) return consolidating;
        consolidating = (async () => {
            state = { ...state, phase: "consolidating", archiveDir: getArchiveDir(), error: null };
            const res = await engine.consolidateCenterMemory(opts);
            if (!res.skipped) {
                const nextIndex = engine.compressSync({ settle: Boolean(opts.settle) });
                state = {
                    ...nextIndex,
                    phase: "ready",
                    consolidation: engine.getConsolidationStatus(),
                    error: res.error || null,
                };
            } else {
                loadExistingIndex();
                state = { ...state, phase: "ready", error: null };
            }
            return { result: res, state: structuredClone(state) };
        })().catch(err => {
            loadExistingIndex();
            state = { ...state, phase: "error", error: err?.message || "中心记忆整理失败" };
            throw err;
        }).finally(() => { consolidating = null; });
        return consolidating;
    }

    async function compressNow(opts = {}) {
        if (running) return running;
        running = (async () => {
            state = { ...state, phase: "compressing", archiveDir: getArchiveDir(), error: null };
            const nextIndex = engine.compressSync(opts);
            state = {
                ...nextIndex,
                phase: "ready",
                error: null,
            };
            return state;
        })().catch(err => {
            state = { ...state, phase: "error", error: err?.message || "记忆压缩失败" };
            return state;
        }).finally(() => { running = null; });
        return running;
    }

    function retain(input) {
        const res = engine.retain(input);
        loadExistingIndex();
        return res;
    }

    function saveLesson(input) {
        const res = engine.saveLesson(input);
        loadExistingIndex();
        return res;
    }

    function recall(query, opts) {
        return engine.recall(query, opts);
    }

    function reflect(opts) {
        const res = engine.reflect(opts);
        loadExistingIndex();
        return res;
    }

    function autoForget(opts) {
        const res = engine.autoForget(opts);
        loadExistingIndex();
        return res;
    }

    function profile(opts) {
        return engine.profile(opts);
    }

    function diagnose() {
        return engine.diagnose();
    }

    function graphQuery(opts) {
        return engine.graphQuery(opts);
    }

    function browse(uri, level) {
        return engine.browse(uri, level);
    }

    function forget(id, opts) {
        const res = engine.forget(id, opts);
        loadExistingIndex();
        return res;
    }

    function readEntry(kind, key) {
        const p = engine.pathsOf();
        if (kind === "graph") {
            const content = fs.existsSync(p.graphMd) ? fs.readFileSync(p.graphMd, "utf8") : "(尚未生成知识图谱)";
            return { kind: "graph", key: "时序知识图谱", mdPath: p.graphMd, rawBytes: Buffer.byteLength(content), compressedBytes: fs.existsSync(p.graphStore) ? fs.statSync(p.graphStore).size : 0, content };
        }
        if (kind === "reflections") {
            const content = fs.existsSync(p.reflectionsMd) ? fs.readFileSync(p.reflectionsMd, "utf8") : "(尚未生成反思洞察)";
            return { kind: "reflections", key: "反思洞察与心智模型", mdPath: p.reflectionsMd, rawBytes: Buffer.byteLength(content), compressedBytes: Buffer.byteLength(content), content };
        }
        if (kind === "consolidation") {
            return engine.readConsolidationReport();
        }
        if (kind === "items") {
            const res = engine.browse(key ? `qlex://items/${key}` : "qlex://items", "L2");
            return { kind: "items", key: key || "全部原子记忆", mdPath: p.itemsMd, rawBytes: Buffer.byteLength(res.content), compressedBytes: fs.existsSync(p.itemsStore) ? fs.statSync(p.itemsStore).size : 0, content: res.content };
        }
        const list = state.items?.[kind] || [];
        const found = list.find(item => item.key === key);
        if (!found || !found.mdPath) throw new Error("未找到对应的记忆归档文件。");
        const content = fs.readFileSync(found.mdPath, "utf8");
        return { ...found, content };
    }

    function exportSyncBundle(meta) {
        return engine.exportSyncBundle(meta);
    }

    function mergeSyncBundle(bundle, opts) {
        const res = engine.mergeSyncBundle(bundle, opts);
        loadExistingIndex();
        return res;
    }

    function getConsolidationStatus() {
        return engine.getConsolidationStatus();
    }

    function readConsolidationReport() {
        return engine.readConsolidationReport();
    }

    loadExistingIndex();

    return {
        compressNow,
        consolidateNow,
        getConsolidationStatus,
        readConsolidationReport,
        retain,
        saveLesson,
        recall,
        reflect,
        autoForget,
        profile,
        diagnose,
        graphQuery,
        browse,
        forget,
        readEntry,
        exportSyncBundle,
        mergeSyncBundle,
        reloadIndex: loadExistingIndex,
        snapshot: () => structuredClone(state),
    };
}

exports.createMemoryArchiver = createMemoryArchiver;
exports.isoWeekKey = isoWeekKey;
