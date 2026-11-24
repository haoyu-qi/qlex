"use strict";

/**
 * QLEX Cross-Device Project & Workspace Context Sync Helper
 * - Pure-JS fast inspection of local git branch / remote / commit (no slow shell spawning)
 * - Syncs lightweight AI workspace context files (AGENTS.md, CLAUDE.md, .cursorrules, .qlex-context.md)
 * - Automatic backup before applying newer remote workspace context files
 * - Smart local auto-matching by git remote URL or folder basename
 */

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { homedir } = require("node:os");

const CONTEXT_FILENAMES = ["AGENTS.md", "CLAUDE.md", ".cursorrules", ".qlex-context.md"];
const MAX_CONTEXT_FILE_BYTES = 64 * 1024;

function normalizeGitRemote(url) {
    if (typeof url !== "string") return "";
    const trimmed = url.trim();
    if (!trimmed) return "";
    // Normalize ssh & https forms to canonical host/owner/repo for cross-device matching
    const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/i);
    if (sshMatch) return `${sshMatch[1].toLowerCase()}/${sshMatch[2].replace(/^\/+/, "").toLowerCase()}`;
    try {
        const u = new URL(trimmed);
        return `${u.hostname.toLowerCase()}${u.pathname.replace(/\.git$/i, "").toLowerCase()}`;
    } catch {
        return trimmed.replace(/\.git$/i, "").toLowerCase();
    }
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
                    // Fallback to packed-refs
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

function inspectWorkspace(directory, { includeContent = false } = {}) {
    if (typeof directory !== "string" || !directory) {
        return { exists: false, gitRemote: "", gitRemoteKey: "", gitBranch: "", gitCommit: "", contextFiles: [], contextHash: "" };
    }
    try {
        const st = fs.statSync(directory);
        if (!st.isDirectory()) {
            return { exists: false, gitRemote: "", gitRemoteKey: "", gitBranch: "", gitCommit: "", contextFiles: [], contextHash: "" };
        }
    } catch {
        return { exists: false, gitRemote: "", gitRemoteKey: "", gitBranch: "", gitCommit: "", contextFiles: [], contextHash: "" };
    }

    const git = readGitMetadata(directory);
    const rawFiles = readWorkspaceContextFiles(directory);
    const contextHash = rawFiles.length
        ? createHash("sha256").update(rawFiles.map(f => `${f.name}:${f.hash}`).join("|")).digest("hex").slice(0, 16)
        : "";
    const contextFiles = includeContent
        ? rawFiles
        : rawFiles.map(({ name, hash, size, mtimeMs }) => ({ name, hash, size, mtimeMs }));

    return {
        exists: true,
        ...git,
        contextFiles,
        contextHash,
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
        // Only overwrite existing local file if remote is strictly newer (with 1.5s tolerance)
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

    // 1. Exact git remote match across discovered workspaces
    if (targetRemoteKey) {
        for (const dp of discoveredProjects) {
            if (!dp?.directory || existingBoundDirs.has(dp.directory)) continue;
            const meta = readGitMetadata(dp.directory);
            if (meta.gitRemoteKey && meta.gitRemoteKey === targetRemoteKey) {
                return { directory: dp.directory, reason: "Git 仓库一致" };
            }
        }
    }

    // 2. Folder basename match across discovered workspaces
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
    normalizeGitRemote,
    inspectWorkspace,
    applyWorkspaceContext,
    findAutoMatchDirectory,
};
