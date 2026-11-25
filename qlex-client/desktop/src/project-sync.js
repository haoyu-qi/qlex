"use strict";

/**
 * QLEX Cross-Device Project & Workspace File Sync Engine
 * - Pure-JS fast inspection of local git branch / remote / commit (no slow shell spawning)
 * - Content-addressed workspace file manifest & delta sync (source code, docs, configs, task/plan/TODO files)
 * - Automatic backup before overwriting older local files (~/.qlex-skill-backups/projects/<syncId>/<stamp>/)
 * - Center mirror cache support so projects pushed from an Endpoint materialize immediately when bound on Center
 * - Smart local auto-matching by git remote URL or folder basename
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { createHash } = require("node:crypto");
const { homedir } = require("node:os");

const CONTEXT_FILENAMES = ["AGENTS.md", "CLAUDE.md", ".cursorrules", ".qlex-context.md", "TODO.md", "TASKS.md", "PLAN.md"];
const MAX_CONTEXT_FILE_BYTES = 64 * 1024;

// Workspace full-file sync guardrails (supports code, docs, Office, PDF, images, diagrams & deliverable zips)
const MAX_PROJECT_FILES = 600;
const MAX_SINGLE_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PROJECT_TOTAL_BYTES = 250 * 1024 * 1024;
const MAX_SCAN_DEPTH = 8;
const MAX_TRANSFER_BATCH_BYTES = 8 * 1024 * 1024;

const IGNORED_DIRS = new Set([
    ".git", ".hg", ".svn", "node_modules", "dist", "build", "out", "output",
    "installers", ".next", ".nuxt", ".venv", "venv", "__pycache__", ".pytest_cache",
    "target", ".cache", ".idea", ".vscode", "coverage", ".turbo", "vendor",
    "Pods", "DerivedData", ".parcel-cache", ".svelte-kit", "tmp", ".tmp",
]);
// Meaningful project dot-directories to keep; other hidden dot-dirs (e.g. .pptx-build, .chart-data-*) are auto-skipped
const ALLOWED_DOT_DIRS = new Set([".github", ".qlex", ".claude", ".codex", ".cursor"]);

const IGNORED_FILES = /^(?:\.DS_Store|Thumbs\.db|Desktop\.ini|\._.*|~\$.*|.*\.pyc|.*\.pyo|.*\.log|.*\.sqlite.*|.*\.db|.*\.db-wal|.*\.db-shm|.*\.dmg|.*\.pkg|.*\.tar(?:\.gz|\.xz|\.bz2)?|.*\.mp4|.*\.mov|.*\.mkv|.*\.avi|.*\.exe|.*\.msi|.*\.dll|.*\.dylib|.*\.so|.*\.o|.*\.a|.*\.class|.*\.wasm|.*\.otf|.*\.ttf|.*\.woff2?)$/i;
const SENSITIVE_FILES = /^(?:\.env(?:\..+)?|.*[._-](?:credential|credentials|secret|secrets|private-key|auth-token)|id_rsa(?:\.pub)?|id_ed25519(?:\.pub)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|.*\.keystore)$/i;
const ALLOWED_EXT = /\.(?:md|mdx|txt|json|jsonc|yaml|yml|toml|ini|conf|cfg|properties|js|mjs|cjs|ts|tsx|jsx|py|go|rs|java|kt|swift|rb|php|c|h|cc|cpp|hpp|cs|sh|bash|zsh|ps1|bat|css|scss|sass|less|html|htm|vue|svelte|astro|svg|sql|xml|csv|tsv|graphql|gql|proto|rst|org|tex|patch|diff|tf|hcl|dockerfile|makefile|gradle|plist|strings|pptx|ppt|docx|doc|xlsx|xls|pdf|rtf|key|pages|numbers|png|jpg|jpeg|webp|gif|bmp|ico|icns|tif|tiff|psd|ai|sketch|fig|drawio|excalidraw|xmind|mm|opml|zip)$/i;
const ALLOWED_BASENAMES = /^(?:README|LICENSE|CHANGELOG|NOTICE|AUTHORS|COPYING|TODO|TASKS|PLAN|PROGRESS|NOTES|Makefile|Dockerfile|Procfile|Gemfile|Rakefile|Justfile|Taskfile|\.gitignore|\.gitattributes|\.editorconfig|\.cursorrules|\.prettierrc(?:\.json)?|\.eslintrc(?:\.json)?|\.npmrc|\.qlex-context\.md)$/i;

function isIgnoredDirectoryName(name) {
    if (!name || IGNORED_DIRS.has(name) || name.startsWith(".qlex-tmp")) return true;
    if (name.startsWith(".") && !ALLOWED_DOT_DIRS.has(name)) return true;
    return false;
}

function safeProjectFolderName(name, syncId = "project") {
    const cleaned = String(name || "")
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
        .replace(/^\.+/, "")
        .replace(/\.+$/, "")
        .trim()
        .slice(0, 80);
    if (cleaned && cleaned !== "." && cleaned !== "..") return cleaned;
    return String(syncId || "project").replace(/[^a-zA-Z0-9\u4e00-\u9fff._-]+/g, "_").slice(0, 64) || "project";
}

function normalizeGitRemote(url) {
    if (typeof url !== "string") return "";
    const trimmed = url.trim();
    if (!trimmed) return "";
    const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/i);
    if (sshMatch) return `${sshMatch[1].toLowerCase()}/${sshMatch[2].replace(/^\/+/, "").toLowerCase()}`;
    try {
        const u = new URL(trimmed);
        return `${u.hostname.toLowerCase()}${u.pathname.replace(/\.git$/i, "").toLowerCase()}`;
    } catch {
        return trimmed.replace(/\.git$/i, "").toLowerCase();
    }
}

function isSafeRelativePath(rel) {
    if (typeof rel !== "string" || !rel || rel.length > 320) return false;
    if (rel.startsWith("/") || rel.startsWith("\\") || rel.includes("\0")) return false;
    const parts = rel.split("/");
    if (parts.length > MAX_SCAN_DEPTH + 2) return false;
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (!p || p === "." || p === ".." || p.includes("\\")) return false;
        if (i < parts.length - 1 && isIgnoredDirectoryName(p)) return false;
        if (i === parts.length - 1 && (IGNORED_DIRS.has(p) || p.startsWith(".qlex-tmp"))) return false;
    }
    const leaf = parts[parts.length - 1];
    if (IGNORED_FILES.test(leaf) || SENSITIVE_FILES.test(leaf)) return false;
    return ALLOWED_EXT.test(leaf) || ALLOWED_BASENAMES.test(leaf);
}

function readGitMetadata(directory) {
    try {
        const dotGit = path.join(directory, ".git");
        if (!fs.existsSync(dotGit)) return { gitRemote: "", gitRemoteKey: "", gitBranch: "", gitCommit: "" };

        let gitDir = dotGit;
        const stat = fs.lstatSync(dotGit);
        if (stat.isFile()) {
            const raw = fs.readFileSync(dotGit, "utf8").trim();
            const m = raw.match(/^gitdir:\s*(.+)$/i);
            if (!m) return { gitRemote: "", gitRemoteKey: "", gitBranch: "", gitCommit: "" };
            gitDir = path.resolve(directory, m[1].trim());
        }

        let gitBranch = "";
        let gitCommit = "";
        const headPath = path.join(gitDir, "HEAD");
        if (fs.existsSync(headPath)) {
            const head = fs.readFileSync(headPath, "utf8").trim();
            const refMatch = head.match(/^ref:\s*(.+)$/);
            if (refMatch) {
                const refName = refMatch[1].trim();
                gitBranch = refName.replace(/^refs\/heads\//, "");
                const refFile = path.join(gitDir, refName);
                if (fs.existsSync(refFile)) {
                    gitCommit = fs.readFileSync(refFile, "utf8").trim().slice(0, 7);
                } else {
                    const packed = path.join(gitDir, "packed-refs");
                    if (fs.existsSync(packed)) {
                        const lines = fs.readFileSync(packed, "utf8").split(/\r?\n/);
                        for (const line of lines) {
                            if (line.startsWith("#") || !line.includes(" ")) continue;
                            const [sha, ref] = line.split(/\s+/);
                            if (ref === refName) {
                                gitCommit = sha.slice(0, 7);
                                break;
                            }
                        }
                    }
                }
            } else if (/^[a-f0-9]{7,40}$/i.test(head)) {
                gitBranch = "detached";
                gitCommit = head.slice(0, 7);
            }
        }

        let gitRemote = "";
        const configPath = path.join(gitDir, "config");
        if (fs.existsSync(configPath)) {
            const cfg = fs.readFileSync(configPath, "utf8");
            const originBlock = cfg.match(/\[remote\s+"origin"\]([\s\S]*?)(?:\n\[|$)/i);
            if (originBlock) {
                const urlMatch = originBlock[1].match(/^\s*url\s*=\s*(.+)$/m);
                if (urlMatch) gitRemote = urlMatch[1].trim();
            }
        }

        return {
            gitRemote,
            gitRemoteKey: normalizeGitRemote(gitRemote),
            gitBranch,
            gitCommit,
        };
    } catch {
        return { gitRemote: "", gitRemoteKey: "", gitBranch: "", gitCommit: "" };
    }
}

function readWorkspaceContextFiles(directory) {
    const files = [];
    for (const name of CONTEXT_FILENAMES) {
        const full = path.join(directory, name);
        try {
            const st = fs.lstatSync(full);
            if (!st.isFile() || st.size <= 0 || st.size > MAX_CONTEXT_FILE_BYTES) continue;
            const content = fs.readFileSync(full, "utf8");
            const hash = createHash("sha256").update(content, "utf8").digest("hex");
            files.push({
                name,
                hash,
                size: st.size,
                mtimeMs: Math.round(st.mtimeMs),
                content,
            });
        } catch {
            // Skip unreadable or missing context files
        }
    }
    return files;
}

function scanProjectFiles(directory, { maxFiles = MAX_PROJECT_FILES, maxFileBytes = MAX_SINGLE_FILE_BYTES, maxTotalBytes = MAX_PROJECT_TOTAL_BYTES } = {}) {
    const manifest = [];
    let totalBytes = 0;
    let truncated = false;
    if (typeof directory !== "string" || !directory) {
        return { files: manifest, fileCount: 0, totalBytes: 0, truncated: false };
    }
    try {
        if (!fs.statSync(directory).isDirectory()) {
            return { files: manifest, fileCount: 0, totalBytes: 0, truncated: false };
        }
    } catch {
        return { files: manifest, fileCount: 0, totalBytes: 0, truncated: false };
    }

    function walk(dir, prefix, depth) {
        if (depth > MAX_SCAN_DEPTH || manifest.length >= maxFiles) {
            if (manifest.length >= maxFiles) truncated = true;
            return;
        }
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (manifest.length >= maxFiles) {
                truncated = true;
                return;
            }
            if (entry.isSymbolicLink()) continue;
            const name = entry.name;
            if (entry.isDirectory()) {
                if (isIgnoredDirectoryName(name)) continue;
                walk(path.join(dir, name), prefix ? `${prefix}/${name}` : name, depth + 1);
                continue;
            }
            if (!entry.isFile()) continue;
            const rel = prefix ? `${prefix}/${name}` : name;
            if (!isSafeRelativePath(rel)) continue;
            const full = path.join(dir, name);
            try {
                const st = fs.lstatSync(full);
                if (!st.isFile() || st.size > maxFileBytes) continue;
                if (totalBytes + st.size > maxTotalBytes) {
                    truncated = true;
                    continue;
                }
                const data = fs.readFileSync(full);
                const hash = createHash("sha256").update(data).digest("hex");
                totalBytes += data.length;
                manifest.push({
                    path: rel,
                    hash,
                    size: data.length,
                    mtimeMs: Math.round(st.mtimeMs),
                    executable: Boolean(st.mode & 0o100),
                });
            } catch {
                // Skip unreadable file
            }
        }
    }

    walk(directory, "", 0);
    return { files: manifest, fileCount: manifest.length, totalBytes, truncated };
}

function diffFileManifests(localFiles = [], remoteFiles = []) {
    const localMap = new Map((Array.isArray(localFiles) ? localFiles : []).map(f => [f.path, f]));
    const remoteMap = new Map((Array.isArray(remoteFiles) ? remoteFiles : []).map(f => [f.path, f]));
    const toPull = [];
    const toPush = [];

    for (const [rel, rf] of remoteMap.entries()) {
        if (!isSafeRelativePath(rel)) continue;
        const lf = localMap.get(rel);
        if (!lf) {
            toPull.push(rel);
        } else if (lf.hash !== rf.hash && (Number(rf.mtimeMs) || 0) > (Number(lf.mtimeMs) || 0) + 1500) {
            toPull.push(rel);
        }
    }

    for (const [rel, lf] of localMap.entries()) {
        if (!isSafeRelativePath(rel)) continue;
        const rf = remoteMap.get(rel);
        if (!rf) {
            toPush.push(rel);
        } else if (lf.hash !== rf.hash && (Number(lf.mtimeMs) || 0) > (Number(rf.mtimeMs) || 0) + 1500) {
            toPush.push(rel);
        }
    }

    return { toPull, toPush };
}

function packProjectFiles(directory, relPaths = [], { maxBatchBytes = MAX_TRANSFER_BATCH_BYTES } = {}) {
    const items = [];
    let totalBytes = 0;
    const baseResolved = path.resolve(directory);
    for (const rel of relPaths) {
        if (!isSafeRelativePath(rel)) continue;
        const full = path.resolve(baseResolved, ...rel.split("/"));
        if (!full.startsWith(baseResolved + path.sep)) continue;
        try {
            const st = fs.lstatSync(full);
            if (!st.isFile() || st.size > MAX_SINGLE_FILE_BYTES) continue;
            if (items.length > 0 && totalBytes + st.size > maxBatchBytes) break;
            const buf = fs.readFileSync(full);
            const hash = createHash("sha256").update(buf).digest("hex");
            totalBytes += buf.length;
            items.push({
                path: rel,
                hash,
                size: buf.length,
                mtimeMs: Math.round(st.mtimeMs),
                executable: Boolean(st.mode & 0o100),
                data: buf.toString("base64"),
            });
        } catch {
            // Skip unreadable
        }
    }
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(items), "utf8")).toString("base64");
    return { gzipBase64: gz, count: items.length, totalBytes };
}

function unpackProjectFiles(gzipBase64) {
    if (typeof gzipBase64 !== "string" || !gzipBase64) return [];
    try {
        const raw = zlib.gunzipSync(Buffer.from(gzipBase64, "base64"));
        if (raw.length > 48 * 1024 * 1024) return [];
        const parsed = JSON.parse(raw.toString("utf8"));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function applyProjectFiles(directory, incomingFiles = [], syncId = "project", backupRoot = path.join(homedir(), ".qlex-skill-backups", "projects")) {
    if (!directory || !Array.isArray(incomingFiles) || !incomingFiles.length) {
        return { written: 0, backedUp: 0, skipped: 0, totalBytes: 0 };
    }
    const baseResolved = path.resolve(directory);
    fs.mkdirSync(baseResolved, { recursive: true, mode: 0o755 });

    let written = 0;
    let backedUp = 0;
    let skipped = 0;
    let totalBytes = 0;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeSync = String(syncId || "project").replace(/[^a-zA-Z0-9._-]/g, "_");

    for (const rf of incomingFiles) {
        if (!rf || !isSafeRelativePath(rf.path) || typeof rf.data !== "string") {
            skipped++;
            continue;
        }
        const target = path.resolve(baseResolved, ...rf.path.split("/"));
        if (!target.startsWith(baseResolved + path.sep)) {
            skipped++;
            continue;
        }
        const buf = Buffer.from(rf.data, "base64");
        if (buf.length > MAX_SINGLE_FILE_BYTES) {
            skipped++;
            continue;
        }
        const remoteHash = createHash("sha256").update(buf).digest("hex");
        if (rf.hash && rf.hash !== remoteHash) {
            skipped++;
            continue;
        }
        const remoteMtime = Number(rf.mtimeMs) || 0;

        let localExists = false;
        let localHash = "";
        let localMtime = 0;
        try {
            const st = fs.lstatSync(target);
            if (st.isFile()) {
                localExists = true;
                localMtime = Math.round(st.mtimeMs);
                localHash = createHash("sha256").update(fs.readFileSync(target)).digest("hex");
            }
        } catch {
            localExists = false;
        }

        if (localExists && localHash === remoteHash) {
            skipped++;
            continue;
        }
        if (localExists && localMtime > remoteMtime + 1500) {
            skipped++;
            continue;
        }

        if (localExists) {
            try {
                const bPath = path.join(backupRoot, safeSync, stamp, ...rf.path.split("/"));
                fs.mkdirSync(path.dirname(bPath), { recursive: true, mode: 0o700 });
                fs.copyFileSync(target, bPath);
                backedUp++;
            } catch { /* best-effort backup */ }
        }

        try {
            fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
            const tmp = `${target}.qlex-tmp-${process.pid}-${Date.now()}`;
            fs.writeFileSync(tmp, buf, { mode: rf.executable ? 0o755 : 0o644 });
            fs.renameSync(tmp, target);
            if (remoteMtime > 0) {
                const t = new Date(remoteMtime);
                fs.utimesSync(target, t, t);
            }
            written++;
            totalBytes += buf.length;
        } catch {
            skipped++;
        }
    }

    return { written, backedUp, skipped, totalBytes };
}

function getProjectMirrorDir(dataDir, syncId) {
    const safe = String(syncId || "project").replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(dataDir, "project-mirror", safe);
}

function materializeMirrorToDirectory(dataDir, syncId, targetDir, backupRoot) {
    if (!dataDir || !syncId || !targetDir) return { written: 0, backedUp: 0, skipped: 0, totalBytes: 0 };
    const mirrorDir = getProjectMirrorDir(dataDir, syncId);
    const scanned = scanProjectFiles(mirrorDir);
    if (!scanned.files.length) return { written: 0, backedUp: 0, skipped: 0, totalBytes: 0 };
    const packed = packProjectFiles(mirrorDir, scanned.files.map(f => f.path), { maxBatchBytes: MAX_PROJECT_TOTAL_BYTES });
    const files = unpackProjectFiles(packed.gzipBase64);
    return applyProjectFiles(targetDir, files, syncId, backupRoot);
}

function inspectWorkspace(directory, { includeContent = false, includeManifest = false } = {}) {
    if (typeof directory !== "string" || !directory) {
        return {
            exists: false, gitRemote: "", gitRemoteKey: "", gitBranch: "", gitCommit: "",
            contextFiles: [], contextHash: "", fileCount: 0, totalBytes: 0, fileManifest: [],
        };
    }
    try {
        const st = fs.statSync(directory);
        if (!st.isDirectory()) {
            return {
                exists: false, gitRemote: "", gitRemoteKey: "", gitBranch: "", gitCommit: "",
                contextFiles: [], contextHash: "", fileCount: 0, totalBytes: 0, fileManifest: [],
            };
        }
    } catch {
        return {
            exists: false, gitRemote: "", gitRemoteKey: "", gitBranch: "", gitCommit: "",
            contextFiles: [], contextHash: "", fileCount: 0, totalBytes: 0, fileManifest: [],
        };
    }

    const git = readGitMetadata(directory);
    const rawFiles = readWorkspaceContextFiles(directory);
    const contextHash = rawFiles.length
        ? createHash("sha256").update(rawFiles.map(f => `${f.name}:${f.hash}`).join("|")).digest("hex").slice(0, 16)
        : "";
    const contextFiles = includeContent
        ? rawFiles
        : rawFiles.map(({ name, hash, size, mtimeMs }) => ({ name, hash, size, mtimeMs }));

    const scanned = scanProjectFiles(directory);

    return {
        exists: true,
        ...git,
        contextFiles,
        contextHash,
        fileCount: scanned.fileCount,
        totalBytes: scanned.totalBytes,
        fileManifest: includeManifest ? scanned.files : [],
    };
}

function applyWorkspaceContext(directory, remoteContextFiles, syncId = "project", backupRoot = path.join(homedir(), ".qlex-skill-backups", "projects")) {
    if (!directory || !Array.isArray(remoteContextFiles) || !remoteContextFiles.length) {
        return { applied: 0, backedUp: 0, skipped: 0 };
    }
    try {
        if (!fs.statSync(directory).isDirectory()) return { applied: 0, backedUp: 0, skipped: 0 };
    } catch {
        return { applied: 0, backedUp: 0, skipped: 0 };
    }

    let applied = 0;
    let backedUp = 0;
    let skipped = 0;

    for (const rf of remoteContextFiles) {
        if (!rf || !CONTEXT_FILENAMES.includes(rf.name) || typeof rf.content !== "string") continue;
        if (Buffer.byteLength(rf.content, "utf8") > MAX_CONTEXT_FILE_BYTES) continue;

        const target = path.join(directory, rf.name);
        const remoteHash = createHash("sha256").update(rf.content, "utf8").digest("hex");
        const remoteMtime = Number(rf.mtimeMs) || 0;

        let localExists = false;
        let localHash = "";
        let localMtime = 0;
        try {
            const st = fs.lstatSync(target);
            if (st.isFile()) {
                localExists = true;
                localMtime = Math.round(st.mtimeMs);
                const cur = fs.readFileSync(target, "utf8");
                localHash = createHash("sha256").update(cur, "utf8").digest("hex");
            }
        } catch {
            localExists = false;
        }

        if (localExists && localHash === remoteHash) {
            skipped++;
            continue;
        }
        if (localExists && remoteMtime <= localMtime + 1500) {
            skipped++;
            continue;
        }

        if (localExists) {
            try {
                const stamp = new Date().toISOString().replace(/[:.]/g, "-");
                const bdir = path.join(backupRoot, syncId.replace(/[^a-zA-Z0-9._-]/g, "_"), stamp);
                fs.mkdirSync(bdir, { recursive: true, mode: 0o700 });
                fs.copyFileSync(target, path.join(bdir, rf.name));
                backedUp++;
            } catch { /* best-effort backup */ }
        }

        try {
            fs.writeFileSync(target, rf.content, "utf8");
            if (remoteMtime > 0) {
                const t = new Date(remoteMtime);
                fs.utimesSync(target, t, t);
            }
            applied++;
        } catch {
            skipped++;
        }
    }

    return { applied, backedUp, skipped };
}

function findAutoMatchDirectory(remoteProject, discoveredProjects = [], existingBoundDirs = new Set()) {
    if (!remoteProject) return null;
    const targetRemoteKey = normalizeGitRemote(remoteProject.gitRemote || "");
    const targetName = String(remoteProject.name || "").trim().toLowerCase();

    if (targetRemoteKey) {
        for (const dp of discoveredProjects) {
            if (!dp?.directory || existingBoundDirs.has(dp.directory)) continue;
            const meta = readGitMetadata(dp.directory);
            if (meta.gitRemoteKey && meta.gitRemoteKey === targetRemoteKey) {
                return { directory: dp.directory, reason: "Git 仓库一致" };
            }
        }
    }

    if (targetName) {
        for (const dp of discoveredProjects) {
            if (!dp?.directory || existingBoundDirs.has(dp.directory)) continue;
            const base = path.basename(dp.directory).toLowerCase();
            if (base === targetName) {
                return { directory: dp.directory, reason: "目录名匹配" };
            }
        }
    }
    return null;
}

module.exports = {
    CONTEXT_FILENAMES,
    MAX_PROJECT_FILES,
    MAX_SINGLE_FILE_BYTES,
    MAX_PROJECT_TOTAL_BYTES,
    isIgnoredDirectoryName,
    safeProjectFolderName,
    normalizeGitRemote,
    isSafeRelativePath,
    inspectWorkspace,
    scanProjectFiles,
    diffFileManifests,
    packProjectFiles,
    unpackProjectFiles,
    applyProjectFiles,
    getProjectMirrorDir,
    materializeMirrorToDirectory,
    applyWorkspaceContext,
    findAutoMatchDirectory,
};
