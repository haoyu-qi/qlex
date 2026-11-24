"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { homedir } = require("node:os");
const { createHash, randomUUID } = require("node:crypto");

const roots = {
    agents: ".agents/skills",
    codex: ".codex/skills",
    claude: ".claude/skills",
    hermes: ".hermes/skills",
    antigravity: ".gemini/config/skills",
    dsh: ".dsh/skills",
    workbuddy: ".workbuddy/skills",
    zcode: ".zcode/skills",
    t3code: ".t3/skills",
};
const namespaceLabels = {
    agents: "Agents",
    codex: "Codex",
    claude: "Claude",
    hermes: "Hermes",
    antigravity: "Antigravity",
    dsh: "DSH",
    workbuddy: "WorkBuddy",
    zcode: "ZCode",
    t3code: "T3 Code",
};
const preferredOrder = ["codex", "claude", "agents", "antigravity", "hermes", "dsh", "workbuddy", "t3code", "zcode"];

const itemLimit = 512;
const fileLimit = 128;
const sizeLimit = 512 * 1024;
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const extension = /\.(?:md|txt|json|yaml|yml|toml|css|html|js|mjs|cjs|ts|py|sh|bash|zsh|ps1|rb|pl|svg|png|webp|gif|jpe?g|pdf|csv|xml)$/i;
const extensionlessSafe = /^(?:LICENSE|README|CHANGELOG|NOTICE|AUTHORS|COPYING)$/i;
const ignoredJunk = /^(?:\.DS_Store|Thumbs\.db|Desktop\.ini|__pycache__|\.pytest_cache|\.gitignore|\.gitkeep|\._.*|.*\.pyc|.*\.pyo)$/i;
const sensitive = /^(?:\.env|.*[._-](?:credential|credentials|secret|secrets|private-key|auth-token)|credential|credentials|secret|secrets|id_rsa|id_ed25519|auth|tokens?|keychain)(?:\..*)?$/i;

function safeFile(relative) {
    if (typeof relative !== "string") return false;
    const parts = relative.split("/");
    const leaf = parts[parts.length - 1];
    return parts.length <= 10 && parts.every(part => idPattern.test(part) && !sensitive.test(part) &&
        !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) && !part.endsWith(".")) &&
        (extension.test(leaf) || extensionlessSafe.test(leaf));
}

function subdirectories(folder) {
    try {
        return fs.readdirSync(folder, { withFileTypes: true });
    } catch {
        return [];
    }
}

function rootAt(home, namespace, create = false) {
    if (!Object.hasOwn(roots, namespace)) return;
    let current = fs.realpathSync(home);
    for (const segment of roots[namespace].split("/")) {
        current = path.join(current, segment);
        if (create) {
            try {
                fs.mkdirSync(current, { mode: 0o700 });
            } catch (error) {
                if (error.code !== "EEXIST") throw error;
            }
        }
        try {
            if (!fs.lstatSync(current).isDirectory()) return;
        } catch {
            return;
        }
    }
    return current;
}

function digest(files) {
    const ordered = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
    return createHash("sha256").update(JSON.stringify(ordered.map(f => [f.path, f.data, f.executable]))).digest("hex");
}

function inspect(folder) {
    const folderStat = fs.lstatSync(folder);
    if (!folderStat.isDirectory()) return;
    const files = [];
    let bytes = 0;
    let complete = true;
    let latestMtime = folderStat.mtimeMs || 0;
    function scan(directory, prefix) {
        for (const entry of subdirectories(directory)) {
            if (ignoredJunk.test(entry.name)) continue;
            const relative = prefix + entry.name;
            const target = path.join(directory, entry.name);
            if (!idPattern.test(entry.name) || sensitive.test(entry.name)) {
                complete = false;
                continue;
            }
            if (entry.isDirectory() && relative.split("/").length < 10) {
                if (!scan(target, relative + "/")) return false;
            } else if (entry.isFile() && safeFile(relative)) {
                const stat = fs.lstatSync(target);
                if (!stat.isFile() || bytes + stat.size > sizeLimit || files.length >= fileLimit) return false;
                if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
                const data = fs.readFileSync(target);
                bytes += data.length;
                if (bytes > sizeLimit) return false;
                files.push({ path: relative, data: data.toString("base64"), executable: Boolean(stat.mode & 0o100) });
            } else {
                complete = false;
            }
        }
        return true;
    }
    if (!scan(folder, "") || !files.some(file => file.path === "SKILL.md")) return;
    return { hash: digest(files), files, complete, mtimeMs: latestMtime, bytes };
}

function packageFiles(pkg) {
    if (!pkg || !hashPattern.test(pkg.hash) || !Array.isArray(pkg.files) || pkg.files.length > fileLimit) return;
    const result = [];
    const names = new Set();
    let bytes = 0;
    for (const file of pkg.files) {
        if (!file || !safeFile(file.path) || typeof file.data !== "string" || typeof file.executable !== "boolean" ||
            file.data.length > Math.ceil(sizeLimit / 3) * 4 || names.has(file.path.toLowerCase())) return;
        const data = Buffer.from(file.data, "base64");
        bytes += data.length;
        if (bytes > sizeLimit || data.toString("base64") !== file.data) return;
        names.add(file.path.toLowerCase());
        result.push({ ...file, data });
    }
    if (!pkg.files.some(file => file.path === "SKILL.md") || pkg.hash !== digest(pkg.files)) return;
    return result;
}

function backupStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
}

function chooseRecommendedVariant(variants) {
    const DAY_MS = 24 * 60 * 60 * 1000;
    return [...variants].sort((a, b) => {
        const diffMs = (b.mtimeMs || 0) - (a.mtimeMs || 0);
        // Only treat mtime as decisive when modified on a clearly newer day (>24h apart);
        // within the same day, a copied older folder often has a slightly later mtime, so prefer richer files/bytes.
        if (Math.abs(diffMs) > DAY_MS) return diffMs;
        if ((b.filesCount || 0) !== (a.filesCount || 0)) return (b.filesCount || 0) - (a.filesCount || 0);
        if ((b.bytes || 0) !== (a.bytes || 0)) return (b.bytes || 0) - (a.bytes || 0);
        if (Math.abs(diffMs) > 5000) return diffMs;
        return preferredOrder.indexOf(a.ns) - preferredOrder.indexOf(b.ns);
    })[0];
}

function createSkillSync(dataDir, home = homedir()) {
    const recordPath = path.join(dataDir, "skill-sync.json");
    const backupRoot = path.join(home, ".qlex-skill-backups");
    const records = new Map();
    try {
        for (const [key, hash] of Object.entries(JSON.parse(fs.readFileSync(recordPath, "utf8")))) {
            if (hashPattern.test(hash)) records.set(key, hash);
        }
    } catch { /* First run. */ }

    let state = {
        phase: "idle",
        count: 0,
        localSynced: 0,
        conflicts: 0,
        conflictDetails: [],
        anomalies: [],
        lastErrors: [],
        backupRoot,
        lastBackupDir: "",
        time: 0,
        localTime: 0,
        namespaces: {},
        uniqueSkills: 0,
        missingLinks: 0,
        skillsPreview: [],
    };
    let running;

    function read(namespace, name) {
        if (typeof name !== "string" || !idPattern.test(name)) return;
        const root = rootAt(home, namespace);
        if (!root) return;
        try {
            return inspect(path.join(root, name));
        } catch {
            return;
        }
    }

    function catalog() {
        const items = [];
        for (const namespace of Object.keys(roots)) {
            const root = rootAt(home, namespace);
            if (!root) continue;
            const entries = subdirectories(root).sort((a, b) => a.name.localeCompare(b.name));
            for (const entry of entries) {
                if (items.length >= itemLimit) return items;
                if (!entry.isDirectory()) continue;
                const skill = read(namespace, entry.name);
                if (skill) items.push({ namespace, name: entry.name, hash: skill.hash });
            }
        }
        return items;
    }

    function saveRecord(key, hash) {
        fs.mkdirSync(path.dirname(recordPath), { recursive: true, mode: 0o700 });
        const next = Object.fromEntries(records);
        next[key] = hash;
        const temporary = recordPath + "." + randomUUID() + ".tmp";
        try {
            fs.writeFileSync(temporary, JSON.stringify(next), { flag: "wx", mode: 0o600 });
            fs.renameSync(temporary, recordPath);
            records.set(key, hash);
        } finally {
            fs.rmSync(temporary, { force: true });
        }
    }

    function install(item, pkg, peer, { force = false, backupSessionDir = "" } = {}) {
        const files = packageFiles(pkg);
        if (!files || pkg.hash !== item.hash) return "skipped";
        const root = rootAt(home, item.namespace, true);
        if (!root) return "conflict";
        const target = path.join(root, item.name);
        const key = peer + ":" + item.namespace + ":" + item.name;
        let existed = false;
        try {
            fs.lstatSync(target);
            existed = true;
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
        }
        if (existed) {
            const current = read(item.namespace, item.name);
            if (current?.hash === item.hash) {
                if (records.get(key) !== item.hash) {
                    try { saveRecord(key, item.hash); } catch { /* ignore */ }
                }
                return "same";
            }
            if (!force) {
                if (!current || current.hash !== records.get(key)) return "conflict";
                if (!current.complete) return "conflict";
            } else if (backupSessionDir) {
                const archiveDest = path.join(backupSessionDir, item.namespace, item.name);
                fs.mkdirSync(path.dirname(archiveDest), { recursive: true, mode: 0o755 });
                fs.cpSync(target, archiveDest, { recursive: true, force: true });
            }
        }
        const temporary = fs.mkdtempSync(path.join(root, ".qlex-skill-"));
        let backup;
        try {
            for (const file of files) {
                const destination = path.join(temporary, ...file.path.split("/"));
                fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
                fs.writeFileSync(destination, file.data, { flag: "wx", mode: file.executable ? 0o700 : 0o600 });
            }
            if (existed) {
                if (!force && read(item.namespace, item.name)?.hash !== records.get(key)) return "conflict";
                backup = path.join(root, ".qlex-backup-" + randomUUID());
                fs.renameSync(target, backup);
            }
            try {
                fs.renameSync(temporary, target);
            } catch (error) {
                if (backup) fs.renameSync(backup, target);
                throw error;
            }
            try {
                saveRecord(key, item.hash);
            } catch (error) {
                fs.rmSync(target, { recursive: true, force: true });
                if (backup) fs.renameSync(backup, target);
                throw error;
            }
            if (backup) fs.rmSync(backup, { recursive: true, force: true });
            return "installed";
        } finally {
            fs.rmSync(temporary, { recursive: true, force: true });
        }
    }

    function scanLocal(enabledNamespaces = Object.keys(roots)) {
        const selected = enabledNamespaces.filter(ns => Object.hasOwn(roots, ns));
        const targetList = selected.length ? selected : Object.keys(roots);
        const namespaces = {};
        const bySkill = new Map();
        const anomalies = [];

        for (const ns of Object.keys(roots)) {
            const root = rootAt(home, ns);
            const exists = Boolean(root);
            let count = 0;
            if (root) {
                for (const entry of subdirectories(root)) {
                    const skillPath = path.join(root, entry.name);
                    if (entry.name.startsWith(".qlex-skill-") || entry.name.startsWith(".qlex-backup-")) {
                        if (targetList.includes(ns)) {
                            anomalies.push({
                                type: "stale-temp",
                                severity: "warn",
                                name: entry.name,
                                ns,
                                label: namespaceLabels[ns],
                                path: skillPath,
                                reason: "检测到上次同步中断残留的临时目录",
                                suggestion: "可一键安全清理",
                                fixable: true,
                            });
                        }
                        continue;
                    }
                    if (entry.isSymbolicLink()) {
                        let targetOk = false;
                        try { targetOk = fs.statSync(skillPath).isDirectory(); } catch { targetOk = false; }
                        if (!targetOk && targetList.includes(ns)) {
                            anomalies.push({
                                type: "broken-symlink",
                                severity: "error",
                                name: entry.name,
                                ns,
                                label: namespaceLabels[ns],
                                path: skillPath,
                                reason: "技能软链接目标已失效或被删除",
                                suggestion: "清理无效软链接后重新同步",
                                fixable: true,
                            });
                        }
                        continue;
                    }
                    if (!entry.isDirectory()) continue;
                    if (!idPattern.test(entry.name)) {
                        if (!entry.name.startsWith(".") && targetList.includes(ns)) {
                            anomalies.push({
                                type: "invalid-name",
                                severity: "warn",
                                name: entry.name,
                                ns,
                                label: namespaceLabels[ns],
                                path: skillPath,
                                reason: "技能目录名包含非规范字符（仅允许字母/数字/._-）",
                                suggestion: "打开目录重命名规范名称",
                                fixable: false,
                            });
                        }
                        continue;
                    }
                    if (!fs.existsSync(path.join(skillPath, "SKILL.md"))) {
                        if (targetList.includes(ns)) {
                            anomalies.push({
                                type: "missing-skill-md",
                                severity: "warn",
                                name: entry.name,
                                ns,
                                label: namespaceLabels[ns],
                                path: skillPath,
                                reason: "目录缺少必需的 SKILL.md 描述文件",
                                suggestion: "补全 SKILL.md 或移出非技能目录",
                                fixable: false,
                            });
                        }
                        continue;
                    }
                    count++;
                    if (targetList.includes(ns)) {
                        let rec = bySkill.get(entry.name);
                        if (!rec) {
                            rec = { name: entry.name, namespaces: [], variants: [], mtimeMs: 0 };
                            bySkill.set(entry.name, rec);
                        }
                        rec.namespaces.push(ns);
                        const pkg = read(ns, entry.name);
                        if (pkg) {
                            if (pkg.mtimeMs > rec.mtimeMs) rec.mtimeMs = pkg.mtimeMs;
                            if (!pkg.complete) {
                                anomalies.push({
                                    type: "incomplete-files",
                                    severity: "warn",
                                    name: entry.name,
                                    ns,
                                    label: namespaceLabels[ns],
                                    path: skillPath,
                                    reason: "包含非白名单后缀、敏感文件名或受限条目（已被安全跳过）",
                                    suggestion: "点击「打开目录」检查非标准文件，或使用覆盖对齐",
                                    fixable: false,
                                });
                            }
                            rec.variants.push({
                                ns,
                                label: namespaceLabels[ns],
                                hash: pkg.hash,
                                shortHash: pkg.hash.slice(0, 8),
                                mtimeMs: pkg.mtimeMs,
                                filesCount: pkg.files.length,
                                bytes: pkg.bytes,
                                complete: pkg.complete,
                                path: skillPath,
                            });
                        } else {
                            anomalies.push({
                                type: "oversized-or-unreadable",
                                severity: "error",
                                name: entry.name,
                                ns,
                                label: namespaceLabels[ns],
                                path: skillPath,
                                reason: "体积超过 512KB / 超过 128 文件上限，或无读取权限",
                                suggestion: "精简技能包内大文件或二进制产物后重试",
                                fixable: false,
                            });
                        }
                    }
                }
            }
            namespaces[ns] = {
                id: ns,
                label: namespaceLabels[ns],
                path: path.join(home, roots[ns]),
                exists,
                count,
                enabled: targetList.includes(ns),
            };
        }

        let missingLinks = 0;
        const conflictDetails = [];
        const preview = [...bySkill.values()]
            .map(item => {
                const missing = targetList.filter(ns => !item.namespaces.includes(ns));
                missingLinks += missing.length;
                const uniqueHashes = new Set(item.variants.map(v => v.hash));
                const hasConflict = uniqueHashes.size > 1;
                if (hasConflict) {
                    const recommended = chooseRecommendedVariant(item.variants);
                    const sortedVars = item.variants
                        .map(v => ({ ...v, recommended: v.ns === recommended?.ns }))
                        .sort((a, b) => Number(b.recommended) - Number(a.recommended) || (b.mtimeMs - a.mtimeMs));
                    const fileCounts = sortedVars.map(v => v.filesCount);
                    const byteCounts = sortedVars.map(v => v.bytes);
                    const minF = Math.min(...fileCounts), maxF = Math.max(...fileCounts);
                    const diffBytes = Math.max(...byteCounts) - Math.min(...byteCounts);
                    const diffHint = maxF !== minF
                        ? `文件数差异 ${minF}↔${maxF} · 体积差 ${(diffBytes / 1024).toFixed(1)} KB`
                        : diffBytes > 0
                            ? `同为 ${maxF} 文件 · 内容体积差 ${(diffBytes / 1024).toFixed(1)} KB`
                            : `同为 ${maxF} 文件 · 内容哈希不同`;
                    conflictDetails.push({
                        name: item.name,
                        recommendedNs: recommended?.ns || sortedVars[0]?.ns,
                        diffHint,
                        variants: sortedVars,
                    });
                }
                return {
                    name: item.name,
                    namespaces: item.namespaces,
                    missing,
                    mtimeMs: item.mtimeMs,
                    hasConflict,
                };
            })
            .sort((a, b) => Number(b.hasConflict) - Number(a.hasConflict) || b.missing.length - a.missing.length || a.name.localeCompare(b.name));

        conflictDetails.sort((a, b) => a.name.localeCompare(b.name));
        anomalies.sort((a, b) => Number(b.fixable) - Number(a.fixable) || a.name.localeCompare(b.name));

        state = {
            ...state,
            namespaces,
            uniqueSkills: bySkill.size,
            missingLinks,
            conflicts: conflictDetails.length,
            conflictDetails,
            anomalies: anomalies.slice(0, 40),
            phase: conflictDetails.length > 0 ? "conflict" : (state.phase === "conflict" ? "ready" : state.phase),
            skillsPreview: preview.slice(0, 60),
        };
        return state;
    }

    function repairAnomalies(enabledNamespaces = Object.keys(roots)) {
        const selected = enabledNamespaces.filter(ns => Object.hasOwn(roots, ns));
        const targets = selected.length ? selected : Object.keys(roots);
        scanLocal(targets);
        let cleaned = 0;
        const errors = [];
        for (const item of state.anomalies) {
            if (!item.fixable) continue;
            try {
                if (item.type === "broken-symlink") {
                    fs.unlinkSync(item.path);
                    cleaned++;
                } else if (item.type === "stale-temp") {
                    fs.rmSync(item.path, { recursive: true, force: true });
                    cleaned++;
                }
            } catch (err) {
                errors.push(`${item.label}/${item.name}: ${err?.message || err}`);
            }
        }
        scanLocal(targets);
        state = { ...state, lastErrors: errors, localTime: Date.now() };
        return { cleaned, errors, state: structuredClone(state) };
    }

    function syncLocal(enabledNamespaces = Object.keys(roots)) {
        const selected = enabledNamespaces.filter(ns => Object.hasOwn(roots, ns));
        if (selected.length < 2) {
            scanLocal(selected);
            state = { ...state, phase: "ready", localSynced: 0, localTime: Date.now() };
            return state;
        }
        state = { ...state, phase: "syncing" };

        const master = new Map();
        for (const ns of selected) {
            const root = rootAt(home, ns);
            if (!root) continue;
            for (const entry of subdirectories(root)) {
                if (!entry.isDirectory() || !idPattern.test(entry.name)) continue;
                const pkg = read(ns, entry.name);
                if (!pkg) continue;
                const prev = master.get(entry.name);
                if (!prev || pkg.mtimeMs > prev.pkg.mtimeMs) {
                    master.set(entry.name, { sourceNs: ns, pkg });
                }
            }
        }

        let installed = 0;
        let syncConflicts = 0;
        for (const [name, { sourceNs, pkg }] of master.entries()) {
            const srcKey = `local:${sourceNs}:${name}`;
            if (records.get(srcKey) !== pkg.hash) {
                try { saveRecord(srcKey, pkg.hash); } catch { /* ignore */ }
            }
            for (const targetNs of selected) {
                if (targetNs === sourceNs) continue;
                const current = read(targetNs, name);
                if (current?.hash === pkg.hash) {
                    const tgtKey = `local:${targetNs}:${name}`;
                    if (records.get(tgtKey) !== pkg.hash) {
                        try { saveRecord(tgtKey, pkg.hash); } catch { /* ignore */ }
                    }
                    continue;
                }
                const outcome = install({ namespace: targetNs, name, hash: pkg.hash }, pkg, "local");
                if (outcome === "installed") installed++;
                else if (outcome === "conflict") syncConflicts++;
            }
        }

        scanLocal(selected);
        const totalConflicts = Math.max(syncConflicts, state.conflictDetails.length);
        state = {
            ...state,
            phase: totalConflicts > 0 ? "conflict" : "ready",
            localSynced: installed,
            conflicts: totalConflicts,
            localTime: Date.now(),
            time: Date.now(),
        };
        return state;
    }

    function resolveConflict(name, sourceNs, enabledNamespaces = Object.keys(roots), { backupSessionDir = "" } = {}) {
        if (typeof name !== "string" || !idPattern.test(name)) throw new Error("无效的技能名称。");
        if (!Object.hasOwn(roots, sourceNs)) throw new Error("无效的源技能目录。");
        const selected = enabledNamespaces.filter(ns => Object.hasOwn(roots, ns));
        const targets = selected.length ? selected : Object.keys(roots);
        const pkg = read(sourceNs, name);
        if (!pkg) throw new Error(`源目录 ${namespaceLabels[sourceNs]} 中不存在有效技能「${name}」。`);

        const sessionDir = backupSessionDir || path.join(backupRoot, backupStamp());
        const srcKey = `local:${sourceNs}:${name}`;
        try { saveRecord(srcKey, pkg.hash); } catch { /* ignore */ }

        let updated = 0;
        let backedUp = 0;
        for (const targetNs of targets) {
            if (targetNs === sourceNs) continue;
            const current = read(targetNs, name);
            if (current?.hash === pkg.hash) {
                const tgtKey = `local:${targetNs}:${name}`;
                if (records.get(tgtKey) !== pkg.hash) {
                    try { saveRecord(tgtKey, pkg.hash); } catch { /* ignore */ }
                }
                continue;
            }
            const hadDifferent = Boolean(current);
            const outcome = install({ namespace: targetNs, name, hash: pkg.hash }, pkg, "local", {
                force: true,
                backupSessionDir: sessionDir,
            });
            if (outcome === "installed") {
                updated++;
                if (hadDifferent) backedUp++;
            }
        }

        scanLocal(targets);
        state = {
            ...state,
            lastBackupDir: backedUp > 0 ? sessionDir : state.lastBackupDir,
            localTime: Date.now(),
            time: Date.now(),
        };
        return {
            name,
            sourceNs,
            updated,
            backedUp,
            backupDir: backedUp > 0 ? sessionDir : "",
            state: structuredClone(state),
        };
    }

    function resolveAllConflicts(strategy = "latest", enabledNamespaces = Object.keys(roots)) {
        const selected = enabledNamespaces.filter(ns => Object.hasOwn(roots, ns));
        const targets = selected.length ? selected : Object.keys(roots);
        scanLocal(targets);
        const list = [...state.conflictDetails];
        if (!list.length) {
            return { resolvedCount: 0, updatedDirs: 0, backedUpDirs: 0, backupDir: "", resolvedSkills: [], state: structuredClone(state) };
        }
        const sessionDir = path.join(backupRoot, backupStamp());
        let updatedDirs = 0;
        let backedUpDirs = 0;
        const resolvedSkills = [];

        for (const conflict of list) {
            const preferred = Object.hasOwn(roots, strategy) && conflict.variants.some(v => v.ns === strategy)
                ? strategy
                : conflict.recommendedNs;
            const res = resolveConflict(conflict.name, preferred, targets, { backupSessionDir: sessionDir });
            updatedDirs += res.updated;
            backedUpDirs += res.backedUp;
            resolvedSkills.push({ name: conflict.name, sourceNs: preferred, updated: res.updated });
        }

        scanLocal(targets);
        state = {
            ...state,
            phase: state.conflictDetails.length > 0 ? "conflict" : "ready",
            lastBackupDir: backedUpDirs > 0 ? sessionDir : state.lastBackupDir,
            localTime: Date.now(),
            time: Date.now(),
        };
        return {
            resolvedCount: resolvedSkills.length,
            updatedDirs,
            backedUpDirs,
            backupDir: backedUpDirs > 0 ? sessionDir : "",
            resolvedSkills,
            state: structuredClone(state),
        };
    }

    function refresh(pairing, enabledNamespaces) {
        if (running) return running;
        running = (async () => {
            scanLocal(enabledNamespaces);
            const { mode, endpoint, online } = pairing.view();
            if (mode !== "endpoint" || endpoint?.status !== "connected" || !online) return state;
            state = { ...state, phase: "syncing" };
            let count = 0;
            let conflicts = 0;
            const response = await pairing.requestSkills();
            if (!Array.isArray(response?.items)) {
                state = { ...state, phase: "center-disabled" };
                return state;
            }
            for (const item of response.items.slice(0, itemLimit)) {
                if (!pairing.store.snapshot().skillSyncEnabled || pairing.view().endpoint?.address !== endpoint.address) break;
                if (!item || !Object.hasOwn(roots, item.namespace) || typeof item.name !== "string" ||
                    !idPattern.test(item.name) || !hashPattern.test(item.hash)) continue;
                if (read(item.namespace, item.name)?.hash === item.hash) continue;
                const result = await pairing.requestSkills({ namespace: item.namespace, name: item.name });
                if (!pairing.store.snapshot().skillSyncEnabled || pairing.view().endpoint?.address !== endpoint.address) break;
                const outcome = install(item, result?.package, endpoint.address);
                if (outcome === "installed") count++;
                if (outcome === "conflict") conflicts++;
            }
            scanLocal(enabledNamespaces);
            const totalConflicts = Math.max(conflicts, state.conflictDetails.length);
            state = {
                ...state,
                phase: totalConflicts > 0 ? "conflict" : "ready",
                count,
                conflicts: totalConflicts,
                time: Date.now(),
            };
            return state;
        })().catch(() => {
            state = { ...state, phase: "error" };
            return state;
        }).finally(() => { running = undefined; });
        return running;
    }

    // Initial passive scan
    scanLocal();

    return {
        catalog,
        read,
        scanLocal,
        syncLocal,
        resolveConflict,
        resolveAllConflicts,
        repairAnomalies,
        refresh,
        snapshot: () => structuredClone(state),
    };
}

exports.createSkillSync = createSkillSync;
exports.SKILL_ROOTS = roots;
