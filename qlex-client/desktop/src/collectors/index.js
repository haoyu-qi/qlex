"use strict";

/**
 * QLEX Native Multi-Agent Log Collector (Zero-External-Dependency)
 *
 * Collects sessions, token usage, workspaces, quotas, and memory topics natively from:
 *  - Codex: ~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl + ~/.codex/history.jsonl
 *  - Claude Code: ~/.claude/projects/<proj>/*.jsonl (incl. subagents) + ~/.claude/history.jsonl
 *  - Antigravity: ~/.t3/userdata/providers/antigravity/.../transcript.jsonl + ~/.gemini/antigravity/brain/**
 *  - Hermes: ~/.hermes/state.db (and profiles/<p>/state.db) via read-only sqlite3
 *  - DSH (DeepSeek Harness): ~/.dsh/sessions/** /session*.jsonl(.zstd) + Desktop harness
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { homedir } = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const SOURCES = ["antigravity", "codex", "claude", "hermes", "dsh", "workbuddy", "zcode", "t3code"];
const SOURCE_LABELS = {
    antigravity: "Antigravity",
    codex: "Codex",
    claude: "Claude Code",
    hermes: "Hermes",
    dsh: "DSH",
    workbuddy: "WorkBuddy",
    zcode: "ZCode",
    t3code: "T3 Code",
};

const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{16,}|(?:password|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^\s"',;]{6,}["']?)/gi;

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

function localDateKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sanitizeTopic(text, maxLen = 200) {
    if (typeof text !== "string") return "";
    return text
        .replace(SECRET_PATTERN, "[REDACTED]")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLen);
}

function safeReaddir(dir) {
    try {
        return fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

function walkFiles(rootDir, predicate, { maxDepth = 5, maxFiles = 600, minMtimeMs = 0 } = {}) {
    const out = [];
    if (!rootDir || !fs.existsSync(rootDir)) return out;
    function scan(dir, depth) {
        if (depth > maxDepth || out.length >= maxFiles) return;
        for (const ent of safeReaddir(dir)) {
            if (out.length >= maxFiles) return;
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                if (ent.name === "node_modules" || ent.name === ".git") continue;
                scan(full, depth + 1);
            } else if (ent.isFile() && predicate(ent.name, full)) {
                try {
                    const st = fs.statSync(full);
                    if (minMtimeMs && st.mtimeMs < minMtimeMs) continue;
                    out.push({ path: full, mtimeMs: st.mtimeMs, size: st.size });
                } catch { /* ignore unreadable */ }
            }
        }
    }
    scan(rootDir, 0);
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function decodeDshWorkspaceSlug(slug) {
    if (typeof slug !== "string" || !slug.startsWith("--")) return "";
    const trimmed = slug.replace(/^--|--$/g, "");
    const decoded = trimmed.replace(/~([0-9A-Fa-f]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    const candidate = "/" + decoded.replace(/-/g, "/");
    return fs.existsSync(candidate) ? candidate : "";
}

function decodeClaudeProjectSlug(slug) {
    if (typeof slug !== "string" || !slug.startsWith("-")) return "";
    const candidate = "/" + slug.slice(1).replace(/-/g, "/");
    return fs.existsSync(candidate) ? candidate : "";
}

function extractRealUserText(raw) {
    if (typeof raw !== "string") return "";
    let s = raw;
    // Strip T3 Code wrapper instructions & extract inner user_request if nested
    const innerMatch = s.match(/<user_request>([\s\S]*?)<\/user_request>/);
    if (innerMatch) {
        s = innerMatch[1];
    } else {
        const upperMatch = s.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
        if (upperMatch) s = upperMatch[1];
    }
    s = s.replace(/<t3_code_instructions>[\s\S]*?<\/t3_code_instructions>/gi, "");
    s = s.replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/gi, "");
    s = s.replace(/<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>/gi, "");
    s = s.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, "");
    s = s.replace(/<runtime_info>[\s\S]*?<\/runtime_info>/gi, "");
    s = s.replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, "");
    if (/^#\s*AGENTS\.md instructions/i.test(s.trim())) return "";
    return sanitizeTopic(s, 200);
}

function decompressZstdSync(buf) {
    if (typeof zlib.zstdDecompressSync === "function") {
        return zlib.zstdDecompressSync(buf).toString("utf8");
    }
    return "";
}

function createFileCache(cachePath) {
    let data = { version: 1, files: {} };
    if (cachePath) {
        try {
            const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
            if (parsed && parsed.version === 1 && parsed.files) data = parsed;
        } catch { /* fresh cache */ }
    }
    let dirty = false;

    function get(filePath, sig) {
        const hit = data.files[filePath];
        if (hit && hit.sig === sig) return hit.value;
        return null;
    }

    function set(filePath, sig, value) {
        data.files[filePath] = { sig, value };
        dirty = true;
    }

    function flush() {
        if (!dirty || !cachePath) return;
        try {
            // Cap cache to 1500 most recent entries
            const keys = Object.keys(data.files);
            if (keys.length > 1500) {
                for (const k of keys.slice(0, keys.length - 1200)) delete data.files[k];
            }
            fs.mkdirSync(path.dirname(cachePath), { recursive: true });
            fs.writeFileSync(cachePath, JSON.stringify(data));
            dirty = false;
        } catch { /* non-fatal */ }
    }

    return { get, set, flush };
}

/**
 * 1. Codex Collector (~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl)
 */
function parseCodexFile(fileInfo, cache) {
    const sig = `${fileInfo.mtimeMs}:${fileInfo.size}`;
    const cached = cache.get(fileInfo.path, sig);
    if (cached) return cached;

    let sessionId = path.basename(fileInfo.path, ".jsonl");
    let workspace = "";
    let lastActive = fileInfo.mtimeMs;
    const dailyBuckets = {}; // date -> { input, output, cacheRead, cacheWrite, tokens }
    const topics = [];
    let prevTotal = null;

    try {
        const text = fs.readFileSync(fileInfo.path, "utf8");
        for (const line of text.split("\n")) {
            if (!line || line[0] !== "{") continue;
            let row;
            try { row = JSON.parse(line); } catch { continue; }
            const ts = Date.parse(row.timestamp) || fileInfo.mtimeMs;
            if (ts > lastActive) lastActive = ts;

            if (row.type === "session_meta" && row.payload) {
                if (row.payload.session_id || row.payload.id) sessionId = String(row.payload.session_id || row.payload.id);
                if (typeof row.payload.cwd === "string" && path.isAbsolute(row.payload.cwd)) workspace = path.normalize(row.payload.cwd);
                continue;
            }

            if (row.type === "event_msg" && row.payload?.type === "token_count" && row.payload.info) {
                const info = row.payload.info;
                const last = info.last_token_usage;
                const total = info.total_token_usage;
                let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
                if (last && typeof last === "object") {
                    cacheRead = num(last.cached_input_tokens);
                    cacheWrite = num(last.cache_write_input_tokens);
                    const rawIn = num(last.input_tokens);
                    input = rawIn >= cacheRead ? rawIn - cacheRead : rawIn;
                    output = num(last.output_tokens);
                } else if (total && typeof total === "object") {
                    const totIn = num(total.input_tokens);
                    const totOut = num(total.output_tokens);
                    const totCr = num(total.cached_input_tokens);
                    const totCw = num(total.cache_write_input_tokens);
                    if (prevTotal) {
                        const dIn = Math.max(0, totIn - prevTotal.totIn);
                        const dCr = Math.max(0, totCr - prevTotal.totCr);
                        input = dIn >= dCr ? dIn - dCr : dIn;
                        cacheRead = dCr;
                        cacheWrite = Math.max(0, totCw - prevTotal.totCw);
                        output = Math.max(0, totOut - prevTotal.totOut);
                    }
                    prevTotal = { totIn, totOut, totCr, totCw };
                }
                const tokens = input + output + cacheRead + cacheWrite;
                if (tokens > 0) {
                    const date = localDateKey(ts);
                    const b = dailyBuckets[date] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0 };
                    b.input += input;
                    b.output += output;
                    b.cacheRead += cacheRead;
                    b.cacheWrite += cacheWrite;
                    b.tokens += tokens;
                    dailyBuckets[date] = b;
                }
                continue;
            }

            if (topics.length < 12 && row.type === "event_msg" && row.payload?.type === "user_message" && typeof row.payload.message === "string") {
                const clean = extractRealUserText(row.payload.message);
                if (clean.length >= 6) topics.push({ date: localDateKey(ts), ts, source: "codex", project: workspace ? path.basename(workspace) : "", text: clean });
            }
        }
    } catch { /* unreadable */ }

    const parsed = { source: "codex", sessionId, workspace, lastActive, dailyBuckets, topics };
    cache.set(fileInfo.path, sig, parsed);
    return parsed;
}

/**
 * 2. Claude Code Collector (~/.claude/projects/<slug>/*.jsonl)
 */
function parseClaudeFile(fileInfo, cache) {
    const sig = `${fileInfo.mtimeMs}:${fileInfo.size}`;
    const cached = cache.get(fileInfo.path, sig);
    if (cached) return cached;

    let sessionId = path.basename(fileInfo.path, ".jsonl");
    const slugDir = path.basename(path.dirname(fileInfo.path));
    let workspace = decodeClaudeProjectSlug(slugDir);
    let lastActive = fileInfo.mtimeMs;
    const dailyBuckets = {};
    const topics = [];
    const seenMsgUsage = new Set();

    try {
        const text = fs.readFileSync(fileInfo.path, "utf8");
        for (const line of text.split("\n")) {
            if (!line || line[0] !== "{") continue;
            let row;
            try { row = JSON.parse(line); } catch { continue; }
            const ts = Date.parse(row.timestamp) || fileInfo.mtimeMs;
            if (ts > lastActive) lastActive = ts;
            if (row.sessionId) sessionId = String(row.sessionId);
            if (!workspace && typeof row.cwd === "string" && path.isAbsolute(row.cwd)) workspace = path.normalize(row.cwd);

            const msg = row.message;
            if (msg && msg.usage && typeof msg.usage === "object") {
                const msgKey = msg.id ? `${msg.id}:${num(msg.usage.output_tokens)}` : null;
                if (msgKey && seenMsgUsage.has(msgKey)) continue;
                if (msgKey) seenMsgUsage.add(msgKey);
                const input = num(msg.usage.input_tokens);
                const output = num(msg.usage.output_tokens);
                const cacheRead = num(msg.usage.cache_read_input_tokens);
                const cacheWrite = num(msg.usage.cache_creation_input_tokens);
                const tokens = input + output + cacheRead + cacheWrite;
                if (tokens > 0) {
                    const date = localDateKey(ts);
                    const b = dailyBuckets[date] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0 };
                    b.input += input;
                    b.output += output;
                    b.cacheRead += cacheRead;
                    b.cacheWrite += cacheWrite;
                    b.tokens += tokens;
                    dailyBuckets[date] = b;
                }
            } else if (topics.length < 12 && (row.type === "user" || msg?.role === "user")) {
                const content = typeof msg?.content === "string"
                    ? msg.content
                    : Array.isArray(msg?.content)
                        ? msg.content.map(c => (typeof c === "string" ? c : c?.text || "")).join(" ")
                        : "";
                const clean = extractRealUserText(content);
                if (clean.length >= 6) topics.push({ date: localDateKey(ts), ts, source: "claude", project: workspace ? path.basename(workspace) : "", text: clean });
            }
        }
    } catch { /* ignore */ }

    const parsed = { source: "claude", sessionId, workspace, lastActive, dailyBuckets, topics };
    cache.set(fileInfo.path, sig, parsed);
    return parsed;
}

/**
 * 3. Antigravity Collector (T3 Code ACP transcripts + ~/.gemini/antigravity/brain)
 */
function parseAntigravityTranscript(fileInfo, cache) {
    const sig = `${fileInfo.mtimeMs}:${fileInfo.size}`;
    const cached = cache.get(fileInfo.path, sig);
    if (cached) return cached;

    // Path shape: .../brain/<conv-id>/.system_generated/logs/transcript.jsonl
    const parts = fileInfo.path.split(path.sep);
    const brainIdx = parts.lastIndexOf("brain");
    const sessionId = brainIdx >= 0 && parts[brainIdx + 1] ? parts[brainIdx + 1] : path.basename(path.dirname(fileInfo.path));
    let workspace = "";
    let lastActive = fileInfo.mtimeMs;
    const dailyBuckets = {};
    const topics = [];

    try {
        const text = fs.readFileSync(fileInfo.path, "utf8");
        for (const line of text.split("\n")) {
            if (!line || line[0] !== "{") continue;
            let row;
            try { row = JSON.parse(line); } catch { continue; }
            const ts = Date.parse(row.created_at || row.timestamp || "") || fileInfo.mtimeMs;
            if (ts > lastActive) lastActive = ts;
            const date = localDateKey(ts);

            const contentStr = typeof row.content === "string"
                ? row.content
                : typeof row.response === "string"
                    ? row.response
                    : JSON.stringify(row.content || row.response || "");

            if (!workspace && contentStr.includes("Command Working Directory:")) {
                const m = contentStr.match(/Command Working Directory:\s*([^\n<]+)/);
                if (m && path.isAbsolute(m[1].trim())) workspace = path.normalize(m[1].trim());
            }

            // Explicit usage if present, else conservative token estimate (~3.5 chars/token for mixed zh/en)
            let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
            const u = row.usage || row.token_usage || row.metadata?.usage;
            if (u && typeof u === "object") {
                input = num(u.input_tokens || u.prompt_tokens);
                output = num(u.output_tokens || u.completion_tokens);
                cacheRead = num(u.cache_read_input_tokens || u.cached_tokens);
                cacheWrite = num(u.cache_write_input_tokens);
            } else if (contentStr.length > 0) {
                const est = Math.max(1, Math.round(contentStr.length / 3.5));
                if (row.type === "PLANNER_RESPONSE") output = est;
                else input = est;
            }
            const tokens = input + output + cacheRead + cacheWrite;
            if (tokens > 0) {
                const b = dailyBuckets[date] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0 };
                b.input += input;
                b.output += output;
                b.cacheRead += cacheRead;
                b.cacheWrite += cacheWrite;
                b.tokens += tokens;
                dailyBuckets[date] = b;
            }

            if (topics.length < 15 && row.type === "USER_INPUT" && typeof row.content === "string") {
                const clean = extractRealUserText(row.content);
                if (clean.length >= 4) {
                    topics.push({ date, ts, source: "antigravity", project: workspace ? path.basename(workspace) : "", text: clean });
                }
            }
        }
    } catch { /* ignore */ }

    const parsed = { source: "antigravity", sessionId, workspace, lastActive, dailyBuckets, topics };
    cache.set(fileInfo.path, sig, parsed);
    return parsed;
}

/**
 * 4. Hermes Collector (~/.hermes/state.db & profiles/<p>/state.db via sqlite3 -readonly -json)
 */
async function collectHermesSessions(home, env, sinceMs) {
    const dbCandidates = [
        path.join(env.HERMES_HOME || path.join(home, ".hermes"), "state.db"),
    ];
    const profilesDir = path.join(env.HERMES_HOME || path.join(home, ".hermes"), "profiles");
    for (const ent of safeReaddir(profilesDir)) {
        if (ent.isDirectory()) {
            const pDb = path.join(profilesDir, ent.name, "state.db");
            if (fs.existsSync(pDb)) dbCandidates.push(pDb);
        }
    }
    const existingDbs = dbCandidates.filter(p => fs.existsSync(p));
    const sessions = [];

    for (const dbPath of existingDbs) {
        const sinceSec = Math.floor(sinceMs / 1000);
        const sql = `SELECT id, cwd, started_at, ended_at, last_activity_at, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, title FROM sessions WHERE COALESCE(last_activity_at, ended_at, started_at) >= ${sinceSec} ORDER BY started_at DESC LIMIT 800;`;
        try {
            const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-json", dbPath, sql], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 });
            const rows = JSON.parse(stdout || "[]");
            for (const r of rows) {
                const tsSec = num(r.last_activity_at || r.ended_at || r.started_at);
                const ts = tsSec > 1e12 ? tsSec : tsSec * 1000;
                if (!ts) continue;
                const date = localDateKey(ts);
                const input = num(r.input_tokens);
                const output = num(r.output_tokens);
                const cacheRead = num(r.cache_read_tokens);
                const cacheWrite = num(r.cache_write_tokens);
                const tokens = input + output + cacheRead + cacheWrite;
                const workspace = typeof r.cwd === "string" && path.isAbsolute(r.cwd) ? path.normalize(r.cwd) : "";
                const topics = r.title ? [{ date, ts, source: "hermes", project: workspace ? path.basename(workspace) : "", text: sanitizeTopic(r.title, 180) }] : [];
                sessions.push({
                    source: "hermes",
                    sessionId: String(r.id),
                    workspace,
                    lastActive: ts,
                    dailyBuckets: tokens > 0 ? { [date]: { input, output, cacheRead, cacheWrite, tokens } } : {},
                    topics,
                });
            }
        } catch { /* sqlite3 unavailable or locked */ }
    }
    return { paths: existingDbs, sessions };
}

/**
 * 5. DSH Collector (~/.dsh/sessions/** /session*.jsonl(.zstd))
 */
function parseDshFile(fileInfo, cache) {
    const sig = `${fileInfo.mtimeMs}:${fileInfo.size}`;
    const cached = cache.get(fileInfo.path, sig);
    if (cached) return cached;

    const sessDir = path.dirname(fileInfo.path);
    const slugDir = path.basename(path.dirname(sessDir));
    const sessionId = path.basename(sessDir);
    let workspace = decodeDshWorkspaceSlug(slugDir);
    let lastActive = fileInfo.mtimeMs;
    const dailyBuckets = {};
    const topics = [];

    try {
        const raw = fileInfo.path.endsWith(".zstd")
            ? decompressZstdSync(fs.readFileSync(fileInfo.path))
            : fs.readFileSync(fileInfo.path, "utf8");
        for (const line of raw.split("\n")) {
            if (!line || line[0] !== "{") continue;
            let row;
            try { row = JSON.parse(line); } catch { continue; }
            const rawTs = row.timestamp || row.createdAt || row.ts;
            const ts = typeof rawTs === "number" ? (rawTs < 1e12 ? rawTs * 1000 : rawTs) : (Date.parse(rawTs || "") || fileInfo.mtimeMs);
            if (ts > lastActive) lastActive = ts;
            if (!workspace && typeof row.cwd === "string" && path.isAbsolute(row.cwd)) workspace = path.normalize(row.cwd);

            const u = row.usage || row.message?.usage || row.payload?.usage;
            if (u && typeof u === "object") {
                const input = num(u.input_tokens || u.prompt_tokens || u.input);
                const output = num(u.output_tokens || u.completion_tokens || u.output);
                const cacheRead = num(u.cache_read_input_tokens || u.prompt_cache_hit_tokens || u.cacheRead);
                const cacheWrite = num(u.cache_creation_input_tokens || u.cacheWrite);
                const tokens = input + output + cacheRead + cacheWrite;
                if (tokens > 0) {
                    const date = localDateKey(ts);
                    const b = dailyBuckets[date] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0 };
                    b.input += input;
                    b.output += output;
                    b.cacheRead += cacheRead;
                    b.cacheWrite += cacheWrite;
                    b.tokens += tokens;
                    dailyBuckets[date] = b;
                }
            }
            if (topics.length < 10 && (row.role === "user" || row.type === "user")) {
                const txt = typeof row.content === "string" ? row.content : typeof row.text === "string" ? row.text : "";
                const clean = extractRealUserText(txt);
                if (clean.length >= 6) topics.push({ date: localDateKey(ts), ts, source: "dsh", project: workspace ? path.basename(workspace) : "", text: clean });
            }
        }
    } catch { /* ignore corrupted/zstd unsupported */ }

    const parsed = { source: "dsh", sessionId, workspace, lastActive, dailyBuckets, topics };
    cache.set(fileInfo.path, sig, parsed);
    return parsed;
}

/**
 * 6. WorkBuddy Collector (~/.workbuddy-ai/workbuddy.db + ~/.workbuddy)
 */
async function collectWorkBuddySessions(home, env, customPath, sinceMs) {
    const dbCandidates = [
        customPath && (customPath.endsWith(".db") ? customPath : path.join(customPath, "workbuddy.db")),
        env.WORKBUDDY_HOME && path.join(env.WORKBUDDY_HOME, "workbuddy.db"),
        path.join(home, ".workbuddy-ai", "workbuddy.db"),
        path.join(home, ".workbuddy", "workbuddy.db"),
    ].filter(p => p && fs.existsSync(p));
    const sessions = [];

    for (const dbPath of dbCandidates) {
        const sql = `SELECT s.id, s.cwd, COALESCE(NULLIF(s.custom_title,''), s.title) AS title, COALESCE(s.last_activity_at, s.updated_at, s.created_at) AS ts, COALESCE(u.used, 0) AS used_tokens FROM sessions s LEFT JOIN session_usage u ON u.session_id = s.id WHERE s.deleted_at IS NULL ORDER BY ts DESC LIMIT 500;`;
        try {
            const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-json", dbPath, sql], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 });
            const rows = JSON.parse(stdout || "[]");
            for (const r of rows) {
                const rawTs = num(r.ts);
                const ts = rawTs > 1e12 ? rawTs : rawTs * 1000;
                if (!ts || ts < sinceMs) continue;
                const date = localDateKey(ts);
                const tokens = num(r.used_tokens);
                const workspace = typeof r.cwd === "string" && path.isAbsolute(r.cwd) ? path.normalize(r.cwd) : "";
                const topics = r.title ? [{ date, ts, source: "workbuddy", project: workspace ? path.basename(workspace) : "", text: sanitizeTopic(r.title, 180) }] : [];
                sessions.push({
                    source: "workbuddy",
                    sessionId: String(r.id),
                    workspace,
                    lastActive: ts,
                    dailyBuckets: tokens > 0 ? { [date]: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, tokens } } : {},
                    topics,
                });
            }
        } catch { /* sqlite3 unavailable or schema mismatch */ }
    }
    const existingRoots = [
        ...dbCandidates,
        path.join(home, ".workbuddy"),
        path.join(home, ".workbuddy-ai"),
    ].filter((p, idx, arr) => p && fs.existsSync(p) && arr.indexOf(p) === idx);
    return { paths: existingRoots, filesScanned: dbCandidates.length, sessions };
}

/**
 * 7. ZCode Collector (~/.zcode/sessions, ~/.zcode/projects, Application Support/ZCode)
 */
function parseZCodeFile(fileInfo, cache) {
    const sig = `${fileInfo.mtimeMs}:${fileInfo.size}`;
    const cached = cache.get(fileInfo.path, sig);
    if (cached) return cached;

    const sessionId = path.basename(fileInfo.path, path.extname(fileInfo.path));
    let workspace = "";
    let lastActive = fileInfo.mtimeMs;
    const dailyBuckets = {};
    const topics = [];

    try {
        const raw = fs.readFileSync(fileInfo.path, "utf8");
        const lines = fileInfo.path.endsWith(".json") ? [raw] : raw.split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) continue;
            let parsedRow;
            try { parsedRow = JSON.parse(trimmed); } catch { continue; }
            const items = Array.isArray(parsedRow) ? parsedRow : [parsedRow];
            for (const row of items) {
                if (!row || typeof row !== "object") continue;
                const rawTs = row.timestamp || row.updatedAt || row.createdAt || row.ts;
                const ts = typeof rawTs === "number" ? (rawTs < 1e12 ? rawTs * 1000 : rawTs) : (Date.parse(rawTs || "") || fileInfo.mtimeMs);
                if (ts > lastActive) lastActive = ts;
                const cwd = row.cwd || row.workspace || row.projectPath;
                if (!workspace && typeof cwd === "string" && path.isAbsolute(cwd)) workspace = path.normalize(cwd);
                const u = row.usage || row.tokenUsage || row.message?.usage;
                if (u && typeof u === "object") {
                    const input = num(u.input_tokens || u.prompt_tokens || u.input);
                    const output = num(u.output_tokens || u.completion_tokens || u.output);
                    const cacheRead = num(u.cache_read_input_tokens || u.cached_tokens || u.cacheRead);
                    const cacheWrite = num(u.cache_creation_input_tokens || u.cacheWrite);
                    const tokens = input + output + cacheRead + cacheWrite || num(u.total_tokens || u.total);
                    if (tokens > 0) {
                        const date = localDateKey(ts);
                        const b = dailyBuckets[date] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0 };
                        b.input += input || tokens;
                        b.output += output;
                        b.cacheRead += cacheRead;
                        b.cacheWrite += cacheWrite;
                        b.tokens += tokens;
                        dailyBuckets[date] = b;
                    }
                }
                if (topics.length < 10 && (row.role === "user" || row.type === "user" || row.title)) {
                    const txt = typeof row.content === "string" ? row.content : typeof row.title === "string" ? row.title : "";
                    const clean = extractRealUserText(txt);
                    if (clean.length >= 4) topics.push({ date: localDateKey(ts), ts, source: "zcode", project: workspace ? path.basename(workspace) : "", text: clean });
                }
            }
        }
    } catch { /* ignore */ }

    const parsed = { source: "zcode", sessionId, workspace, lastActive, dailyBuckets, topics };
    cache.set(fileInfo.path, sig, parsed);
    return parsed;
}

/**
 * 8. T3 Code Collector (~/.t3/userdata/statev2.sqlite — threads & workspaces)
 */
async function collectT3CodeSessions(home, env, customPath, sinceMs) {
    const dbCandidates = [
        customPath && (customPath.endsWith(".sqlite") ? customPath : path.join(customPath, "statev2.sqlite")),
        env.T3_HOME && path.join(env.T3_HOME, "userdata", "statev2.sqlite"),
        path.join(home, ".t3", "userdata", "statev2.sqlite"),
    ].filter(p => p && fs.existsSync(p));
    const sessions = [];

    for (const dbPath of dbCandidates) {
        const sqlV2 = `SELECT t.thread_id AS id, t.title, t.updated_at, t.created_at, p.workspace_root AS cwd FROM orchestration_v2_projection_threads t LEFT JOIN projection_projects p ON p.project_id = t.project_id WHERE t.deleted_at IS NULL ORDER BY t.updated_at DESC LIMIT 400;`;
        const sqlV1 = `SELECT t.thread_id AS id, t.title, t.updated_at, t.created_at, p.workspace_root AS cwd FROM projection_threads t LEFT JOIN projection_projects p ON p.project_id = t.project_id WHERE t.deleted_at IS NULL ORDER BY t.updated_at DESC LIMIT 400;`;
        let rows = [];
        try {
            const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-json", dbPath, sqlV2], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 });
            rows = JSON.parse(stdout || "[]");
        } catch {
            try {
                const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-json", dbPath, sqlV1], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 });
                rows = JSON.parse(stdout || "[]");
            } catch { /* ignore */ }
        }
        for (const r of rows) {
            const ts = Date.parse(r.updated_at || r.created_at || "") || 0;
            if (!ts || ts < sinceMs) continue;
            const date = localDateKey(ts);
            const workspace = typeof r.cwd === "string" && path.isAbsolute(r.cwd) ? path.normalize(r.cwd) : "";
            const title = sanitizeTopic(r.title || "", 180);
            const topics = title && title !== "New thread" ? [{ date, ts, source: "t3code", project: workspace ? path.basename(workspace) : "", text: title }] : [];
            sessions.push({
                source: "t3code",
                sessionId: String(r.id),
                workspace,
                lastActive: ts,
                dailyBuckets: {},
                topics,
            });
        }
    }
    return { paths: dbCandidates, filesScanned: dbCandidates.length, sessions };
}

/**
 * Aggregate native parsed sessions into QLEX Usage Report + Diagnostics + Topics
 */
function buildWindowReport(parsedSessions, sinceDateKey) {
    const totals = Object.fromEntries(SOURCES.map(s => [s, { tokens: 0, sessions: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }]));
    const projectMap = new Map();
    const sessionList = [];
    const dailyMap = new Map();

    for (const sess of parsedSessions) {
        let sTokens = 0, sIn = 0, sOut = 0, sCr = 0, sCw = 0;
        for (const [date, b] of Object.entries(sess.dailyBuckets || {})) {
            if (sinceDateKey && date < sinceDateKey) continue;
            sIn += b.input;
            sOut += b.output;
            sCr += b.cacheRead;
            sCw += b.cacheWrite;
            sTokens += b.tokens;
            dailyMap.set(date, (dailyMap.get(date) || 0) + b.tokens);
        }
        // Include active sessions inside window even if token count is 0
        const activeDate = localDateKey(sess.lastActive || 0);
        if (sTokens === 0 && (!sinceDateKey || activeDate < sinceDateKey)) continue;

        const bucket = totals[sess.source];
        if (!bucket) continue;
        bucket.tokens += sTokens;
        bucket.input += sIn;
        bucket.output += sOut;
        bucket.cacheRead += sCr;
        bucket.cacheWrite += sCw;
        bucket.sessions += 1;

        sessionList.push({
            id: sess.sessionId,
            source: sess.source,
            workspace: sess.workspace || "",
            tokens: sTokens,
            lastActive: sess.lastActive || 0,
        });

        if (sess.workspace) {
            const p = projectMap.get(sess.workspace) || {
                name: path.basename(sess.workspace),
                directory: sess.workspace,
                tokens: 0,
                sessions: 0,
                lastActive: 0,
                sources: [],
            };
            p.tokens += sTokens;
            p.sessions += 1;
            p.lastActive = Math.max(p.lastActive, sess.lastActive || 0);
            if (!p.sources.includes(sess.source)) p.sources.push(sess.source);
            projectMap.set(sess.workspace, p);
        }
    }

    const daily = [...dailyMap.entries()]
        .map(([date, tokens]) => ({ date, tokens }))
        .sort((a, b) => a.date.localeCompare(b.date));

    return {
        total: Object.values(totals).reduce((sum, x) => sum + x.tokens, 0),
        totals,
        projects: [...projectMap.values()].sort((a, b) => b.lastActive - a.lastActive || b.tokens - a.tokens),
        sessions: sessionList.sort((a, b) => b.lastActive - a.lastActive),
        daily,
    };
}

async function collectAllNative({ home = homedir(), env = process.env, cachePath = "", days = 90, customPaths = {} } = {}) {
    const cache = createFileCache(cachePath);
    const now = Date.now();
    const minMtimeMs = now - days * 86400_000;
    const allSessions = [];
    const diagnostics = {};

    // 1. Codex
    const codexDir = customPaths.codex || path.join(env.CODEX_HOME || path.join(home, ".codex"), "sessions");
    const codexFiles = walkFiles(codexDir, name => /^rollout-.*\.jsonl$/.test(name), { maxDepth: 4, maxFiles: 300, minMtimeMs });
    const codexSessions = codexFiles.map(f => parseCodexFile(f, cache));
    allSessions.push(...codexSessions);
    diagnostics.codex = {
        source: "codex", label: SOURCE_LABELS.codex,
        paths: fs.existsSync(codexDir) ? [codexDir] : [],
        filesScanned: codexFiles.length,
        sessionsFound: codexSessions.length,
        lastActive: codexFiles[0]?.mtimeMs || 0,
        status: codexFiles.length ? "ok" : (fs.existsSync(codexDir) ? "empty" : "missing"),
    };

    // 2. Claude Code
    const claudeDir = customPaths.claude || path.join(home, ".claude", "projects");
    const claudeFiles = walkFiles(claudeDir, name => name.endsWith(".jsonl"), { maxDepth: 4, maxFiles: 350, minMtimeMs });
    const claudeSessions = claudeFiles.map(f => parseClaudeFile(f, cache));
    allSessions.push(...claudeSessions);
    diagnostics.claude = {
        source: "claude", label: SOURCE_LABELS.claude,
        paths: fs.existsSync(claudeDir) ? [claudeDir] : [],
        filesScanned: claudeFiles.length,
        sessionsFound: claudeSessions.length,
        lastActive: claudeFiles[0]?.mtimeMs || 0,
        status: claudeFiles.length ? "ok" : (fs.existsSync(claudeDir) ? "empty" : "missing"),
    };

    // 3. Antigravity (T3 Code ACP + ~/.gemini/antigravity)
    const agRoots = [
        customPaths.antigravity,
        path.join(home, ".t3", "userdata", "providers", "antigravity"),
        path.join(home, ".gemini", "antigravity", "brain"),
    ].filter(p => p && fs.existsSync(p));
    const agFiles = [];
    for (const root of agRoots) {
        agFiles.push(...walkFiles(root, name => name === "transcript.jsonl", { maxDepth: 6, maxFiles: 250, minMtimeMs }));
    }
    const agSessions = agFiles.map(f => parseAntigravityTranscript(f, cache));
    allSessions.push(...agSessions);
    diagnostics.antigravity = {
        source: "antigravity", label: SOURCE_LABELS.antigravity,
        paths: agRoots,
        filesScanned: agFiles.length,
        sessionsFound: agSessions.length,
        lastActive: agFiles[0]?.mtimeMs || 0,
        status: agFiles.length ? "ok" : (agRoots.length ? "empty" : "missing"),
    };

    // 4. Hermes
    const hermesRes = await collectHermesSessions(home, env, minMtimeMs);
    allSessions.push(...hermesRes.sessions);
    diagnostics.hermes = {
        source: "hermes", label: SOURCE_LABELS.hermes,
        paths: hermesRes.paths,
        filesScanned: hermesRes.paths.length,
        sessionsFound: hermesRes.sessions.length,
        lastActive: hermesRes.sessions[0]?.lastActive || 0,
        status: hermesRes.sessions.length ? "ok" : (hermesRes.paths.length ? "empty" : "missing"),
    };

    // 5. DSH
    const dshRoots = [
        customPaths.dsh,
        env.DSH_HOME && path.join(env.DSH_HOME, "sessions"),
        path.join(home, "Library/Application Support/@deepseek-ai/dsh-desktop/harness/sessions"),
        path.join(home, ".dsh", "sessions"),
    ].filter(p => p && fs.existsSync(p));
    const dshFiles = [];
    for (const root of dshRoots) {
        dshFiles.push(...walkFiles(root, name => /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/.test(name), { maxDepth: 4, maxFiles: 200, minMtimeMs }));
    }
    const dshSessions = dshFiles.map(f => parseDshFile(f, cache));
    allSessions.push(...dshSessions);
    diagnostics.dsh = {
        source: "dsh", label: SOURCE_LABELS.dsh,
        paths: dshRoots,
        filesScanned: dshFiles.length,
        sessionsFound: dshSessions.length,
        lastActive: dshFiles[0]?.mtimeMs || 0,
        status: dshFiles.length ? "ok" : (dshRoots.length ? "empty" : "missing"),
    };

    // 6. WorkBuddy
    const wbRes = await collectWorkBuddySessions(home, env, customPaths.workbuddy, minMtimeMs);
    allSessions.push(...wbRes.sessions);
    diagnostics.workbuddy = {
        source: "workbuddy", label: SOURCE_LABELS.workbuddy,
        paths: wbRes.paths,
        filesScanned: wbRes.filesScanned,
        sessionsFound: wbRes.sessions.length,
        lastActive: wbRes.sessions[0]?.lastActive || 0,
        status: wbRes.sessions.length ? "ok" : (wbRes.paths.length ? "empty" : "missing"),
    };

    // 7. ZCode
    const zcodeRoots = [
        customPaths.zcode,
        env.ZCODE_HOME,
        path.join(home, ".zcode", "sessions"),
        path.join(home, ".zcode", "projects"),
        path.join(home, "Library/Application Support/ZCode/sessions"),
    ].filter(p => p && fs.existsSync(p));
    const zcodeFiles = [];
    for (const root of zcodeRoots) {
        zcodeFiles.push(...walkFiles(root, name => /\.(?:jsonl|json)$/i.test(name), { maxDepth: 4, maxFiles: 200, minMtimeMs }));
    }
    const zcodeSessions = zcodeFiles.map(f => parseZCodeFile(f, cache));
    allSessions.push(...zcodeSessions);
    diagnostics.zcode = {
        source: "zcode", label: SOURCE_LABELS.zcode,
        paths: zcodeRoots,
        filesScanned: zcodeFiles.length,
        sessionsFound: zcodeSessions.length,
        lastActive: zcodeFiles[0]?.mtimeMs || 0,
        status: zcodeFiles.length ? "ok" : (zcodeRoots.length ? "empty" : "missing"),
    };

    // 8. T3 Code
    const t3Res = await collectT3CodeSessions(home, env, customPaths.t3code, minMtimeMs);
    allSessions.push(...t3Res.sessions);
    diagnostics.t3code = {
        source: "t3code", label: SOURCE_LABELS.t3code,
        paths: t3Res.paths,
        filesScanned: t3Res.filesScanned,
        sessionsFound: t3Res.sessions.length,
        lastActive: t3Res.sessions[0]?.lastActive || 0,
        status: t3Res.sessions.length ? "ok" : (t3Res.paths.length ? "empty" : "missing"),
    };

    cache.flush();

    const todayKey = localDateKey(now);
    const weekStart = localDateKey(now - 6 * 86400_000);
    const topicsByDate = new Map();
    for (const sess of allSessions) {
        for (const t of sess.topics || []) {
            if (!topicsByDate.has(t.date)) topicsByDate.set(t.date, []);
            const list = topicsByDate.get(t.date);
            if (list.length < 30 && !list.some(x => x.text === t.text)) list.push(t);
        }
    }

    return {
        sessions: allSessions,
        today: buildWindowReport(allSessions, todayKey),
        week: buildWindowReport(allSessions, weekStart),
        windowReport: (windowDays) => buildWindowReport(allSessions, localDateKey(now - (windowDays - 1) * 86400_000)),
        topicsByDate,
        diagnostics,
        collectedAt: Date.now(),
    };
}

module.exports = {
    SOURCES,
    SOURCE_LABELS,
    collectAllNative,
    buildWindowReport,
    extractRealUserText,
    localDateKey,
};
