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

const NOISE_CRON_TITLE_RE = /^(?:每日工作日报|个人日报|个人周报|工作日报|邮件简报|周报汇总|月报汇总|定时任务|scheduled\s+task|daily\s+digest|daily\s+standup|morning\s+brief|evening\s+brief)/i;
const NOISE_DATE_BADGE_RE = /(?:（\d{2}:\d{2}）|\(\d{2}:\d{2}\))?\s*[·•]\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}(?:\s+\d{2}:\d{2})?$/i;
const NOISE_SYSTEM_RE = /^(?:<system-reminder>|<copilot-context>|group\s+chat\s+system:|context\s+handoff|provider\s+context\s+handoff|describe\s+contents\s+of\s+attached\s+image|attached\s+image|\[historical\s+|\[image:|#\s*agents\.md\s+instructions)/i;
const NOISE_TRIVIAL_CMD_RE = /^(?:implement\s+the\s+plan\.?|continue\.?|ok\.?|yes\.?|done\.?|继续|好的|收到|确认|修复|打包推送|打包|推送|授权好了|核对下|核对一下|看看|试一下|重新生成|开始吧|可以|可以的|没问题|好的谢谢|用飞书\s*cli\s*获取内容|梳理下项目[，,。]?\s*(?:并给出优化建议)?)$/i;
const NOISE_SOCIAL_SHARE_RE = /复制打开抖音|长按复制此条消息|打开小红书|打开哔哩哔哩/i;

function isNoiseTopicText(text, meta = {}) {
    const s = String(text || "").trim();
    if (!s || s.length < 6) return true;
    if (meta.sessionId && /^cron_/i.test(String(meta.sessionId))) return true;
    if (NOISE_CRON_TITLE_RE.test(s) || NOISE_DATE_BADGE_RE.test(s)) return true;
    if (NOISE_SYSTEM_RE.test(s) || NOISE_SOCIAL_SHARE_RE.test(s)) return true;
    if (NOISE_TRIVIAL_CMD_RE.test(s)) return true;
    // Reject bare URLs / paths with almost no surrounding semantic text
    const withoutUrls = s.replace(/https?:\/\/\S+/gi, "").replace(/(?:^|\s)\/[\w.\-\/\u4e00-\u9fff]+/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
    if (withoutUrls.length < 6) return true;
    return false;
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
    // If T3 context handoff wrapper is present, take only the trailing "User message:" block
    const handoffIdx = s.lastIndexOf("\nUser message:\n");
    if (handoffIdx >= 0 && /Context handoff/i.test(s.slice(0, handoffIdx))) {
        s = s.slice(handoffIdx + "\nUser message:\n".length);
    }
    s = s.replace(/<t3_code_instructions>[\s\S]*?<\/t3_code_instructions>/gi, "");
    s = s.replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/gi, "");
    s = s.replace(/<SYSTEM_MESSAGE>[\s\S]*?<\/SYSTEM_MESSAGE>/gi, "");
    s = s.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, "");
    s = s.replace(/<runtime_info>[\s\S]*?<\/runtime_info>/gi, "");
    s = s.replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, "");
    s = s.replace(/<workspace_folders>[\s\S]*?<\/workspace_folders>/gi, "");
    s = s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "");
    s = s.replace(/<copilot-context>[\s\S]*?<\/copilot-context>/gi, "");
    s = s.replace(/\[Image:[^\]]*\]/gi, "");
    if (/^#\s*AGENTS\.md instructions/i.test(s.trim())) return "";
    return sanitizeTopic(s, 200);
}

const ZSTD_MAGIC = Buffer.from([0x28, 0xB5, 0x2F, 0xFD]);

function decompressZstdSync(buf) {
    if (typeof zlib.zstdDecompressSync !== "function" || !Buffer.isBuffer(buf) || !buf.length) {
        return "";
    }
    // DSH appends each event batch as a concatenated ZSTD frame; Node's zstdDecompressSync stops after frame 1.
    const offsets = [];
    let idx = 0;
    while ((idx = buf.indexOf(ZSTD_MAGIC, idx)) !== -1) {
        offsets.push(idx);
        idx += 4;
    }
    if (offsets.length <= 1) {
        return zlib.zstdDecompressSync(buf).toString("utf8");
    }
    const chunks = [];
    for (let i = 0; i < offsets.length; i++) {
        const end = i + 1 < offsets.length ? offsets[i + 1] : buf.length;
        try {
            chunks.push(zlib.zstdDecompressSync(buf.subarray(offsets[i], end)).toString("utf8"));
        } catch {
            // Rare false-positive magic inside compressed payload: merge with next frame boundary
            if (i + 1 < offsets.length) {
                try {
                    const nextEnd = i + 2 < offsets.length ? offsets[i + 2] : buf.length;
                    chunks.push(zlib.zstdDecompressSync(buf.subarray(offsets[i], nextEnd)).toString("utf8"));
                    i++;
                } catch { /* skip corrupt frame */ }
            }
        }
    }
    return chunks.join("\n");
}

function createFileCache(cachePath) {
    let data = { version: 1, files: {}, sessionLedgers: {}, nativeSummary: null };
    if (cachePath) {
        try {
            const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
            if (parsed && parsed.version === 1 && parsed.files) {
                data = {
                    version: 1,
                    files: parsed.files || {},
                    sessionLedgers: parsed.sessionLedgers && typeof parsed.sessionLedgers === "object" ? parsed.sessionLedgers : {},
                    nativeSummary: parsed.nativeSummary || null,
                };
            }
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

    function getLedger(key) {
        return data.sessionLedgers[key] || null;
    }

    function setLedger(key, ledger) {
        data.sessionLedgers[key] = ledger;
        dirty = true;
    }

    function setNativeSummary(summary) {
        data.nativeSummary = summary;
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
            const ledgerKeys = Object.keys(data.sessionLedgers);
            if (ledgerKeys.length > 2000) {
                const sorted = ledgerKeys.sort((a, b) => (data.sessionLedgers[a]?.updatedAt || 0) - (data.sessionLedgers[b]?.updatedAt || 0));
                for (const k of sorted.slice(0, ledgerKeys.length - 1600)) delete data.sessionLedgers[k];
            }
            fs.mkdirSync(path.dirname(cachePath), { recursive: true });
            fs.writeFileSync(cachePath, JSON.stringify(data));
            dirty = false;
        } catch { /* non-fatal */ }
    }

    return { get, set, getLedger, setLedger, setNativeSummary, flush };
}

/**
 * Attribute cumulative session token counters (e.g. Hermes / WorkBuddy SQLite sessions)
 * into stable per-day buckets so resuming a multi-day session NEVER steals tokens from past days.
 *
 * - First sight: if `initialDayWeights` spans multiple dates (from messages timestamps), split
 *   proportionally across those dates with integer remainder on the latest date.
 * - Subsequent sights: freeze all historical date buckets and attribute ONLY positive deltas
 *   (`newTotal - prevTotal`) to `activeDate`.
 */
function allocateCumulativeSessionBuckets(cache, ledgerKey, totals, activeDate, initialDayWeights = null) {
    const clean = {
        input: num(totals?.input),
        output: num(totals?.output),
        cacheRead: num(totals?.cacheRead),
        cacheWrite: num(totals?.cacheWrite),
        tokens: num(totals?.tokens),
    };
    if (clean.tokens <= 0) {
        const existing = cache?.getLedger?.(ledgerKey);
        return existing?.buckets ? structuredClone(existing.buckets) : {};
    }

    const existing = cache?.getLedger?.(ledgerKey);
    if (existing && existing.buckets && existing.lastTotals) {
        const buckets = structuredClone(existing.buckets);
        const prev = existing.lastTotals;
        const dIn = Math.max(0, clean.input - num(prev.input));
        const dOut = Math.max(0, clean.output - num(prev.output));
        const dCr = Math.max(0, clean.cacheRead - num(prev.cacheRead));
        const dCw = Math.max(0, clean.cacheWrite - num(prev.cacheWrite));
        const dTok = Math.max(0, clean.tokens - num(prev.tokens));
        if (dTok > 0 || dIn > 0 || dOut > 0 || dCr > 0 || dCw > 0) {
            const b = buckets[activeDate] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0 };
            b.input += dIn;
            b.output += dOut;
            b.cacheRead += dCr;
            b.cacheWrite += dCw;
            b.tokens += dTok || (dIn + dOut + dCr + dCw);
            buckets[activeDate] = b;
            cache.setLedger(ledgerKey, {
                lastTotals: {
                    input: Math.max(num(prev.input), clean.input),
                    output: Math.max(num(prev.output), clean.output),
                    cacheRead: Math.max(num(prev.cacheRead), clean.cacheRead),
                    cacheWrite: Math.max(num(prev.cacheWrite), clean.cacheWrite),
                    tokens: Math.max(num(prev.tokens), clean.tokens),
                },
                buckets,
                updatedAt: Date.now(),
            });
        }
        return buckets;
    }

    // First-time attribution
    const buckets = {};
    const weightEntries = Array.isArray(initialDayWeights)
        ? initialDayWeights.filter(w => w && /^\d{4}-\d{2}-\d{2}$/.test(w.date) && num(w.weight) > 0)
            .sort((a, b) => a.date.localeCompare(b.date))
        : [];
    const totalWeight = weightEntries.reduce((s, w) => s + num(w.weight), 0);

    if (weightEntries.length > 1 && totalWeight > 0) {
        const rem = { ...clean };
        for (let i = 0; i < weightEntries.length; i++) {
            const { date, weight } = weightEntries[i];
            const isLast = i === weightEntries.length - 1;
            const share = isLast
                ? { ...rem }
                : {
                    input: Math.min(rem.input, Math.round((clean.input * num(weight)) / totalWeight)),
                    output: Math.min(rem.output, Math.round((clean.output * num(weight)) / totalWeight)),
                    cacheRead: Math.min(rem.cacheRead, Math.round((clean.cacheRead * num(weight)) / totalWeight)),
                    cacheWrite: Math.min(rem.cacheWrite, Math.round((clean.cacheWrite * num(weight)) / totalWeight)),
                    tokens: 0,
                };
            if (!isLast) {
                share.tokens = share.input + share.output + share.cacheRead + share.cacheWrite;
                if (share.tokens === 0 && clean.tokens > 0) {
                    share.tokens = Math.min(rem.tokens, Math.round((clean.tokens * num(weight)) / totalWeight));
                }
                rem.input = Math.max(0, rem.input - share.input);
                rem.output = Math.max(0, rem.output - share.output);
                rem.cacheRead = Math.max(0, rem.cacheRead - share.cacheRead);
                rem.cacheWrite = Math.max(0, rem.cacheWrite - share.cacheWrite);
                rem.tokens = Math.max(0, rem.tokens - share.tokens);
            }
            if (share.tokens > 0) buckets[date] = share;
        }
    } else {
        buckets[activeDate] = { ...clean };
    }

    if (cache?.setLedger) {
        cache.setLedger(ledgerKey, {
            lastTotals: { ...clean },
            buckets,
            updatedAt: Date.now(),
        });
    }
    return buckets;
}

/**
 * 1. Codex Collector (~/.codex/sessions/<YYYY>/<MM>/<DD>/rollout-*.jsonl)
 */
function parseCodexFile(fileInfo, cache) {
    const sig = `codex2:${fileInfo.mtimeMs}:${fileInfo.size}`;
    const cached = cache.get(fileInfo.path, sig);
    if (cached) return cached;

    let sessionId = path.basename(fileInfo.path, ".jsonl");
    let workspace = "";
    let lastActive = fileInfo.mtimeMs;
    const dailyBuckets = {}; // date -> { input, output, cacheRead, cacheWrite, tokens }
    const topicsByDay = new Map();
    let prevTotal = null;

    const pushCodexTopic = (ts, rawMsg) => {
        if (typeof rawMsg !== "string" || !rawMsg) return;
        const clean = extractRealUserText(rawMsg);
        if (!clean || clean.length < 6 || /^\$[a-z0-9._-]+$/i.test(clean) || isNoiseTopicText(clean)) return;
        const date = localDateKey(ts);
        let list = topicsByDay.get(date);
        if (!list) { list = []; topicsByDay.set(date, list); }
        if (!list.some(x => x.text === clean)) {
            list.push({ date, ts, source: "codex", project: workspace ? path.basename(workspace) : "", text: clean });
            if (list.length > 8) list.shift();
        }
    };

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

            if (row.type === "event_msg" && row.payload?.type === "user_message" && typeof row.payload.message === "string") {
                pushCodexTopic(ts, row.payload.message);
            } else if (row.type === "response_item" && row.payload?.type === "message" && row.payload?.role === "user") {
                const content = Array.isArray(row.payload.content)
                    ? row.payload.content.map(c => (typeof c === "string" ? c : c?.text || "")).join(" ")
                    : typeof row.payload.content === "string" ? row.payload.content : "";
                pushCodexTopic(ts, content);
            }
        }
    } catch { /* unreadable */ }

    const topics = [];
    const projName = workspace ? path.basename(workspace) : "";
    for (const d of [...topicsByDay.keys()].sort().slice(-14)) {
        for (const t of topicsByDay.get(d)) {
            if (!t.project && projName) t.project = projName;
            topics.push(t);
        }
    }

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
 * Reads real top-level token counters (`input_tokens`, `output_tokens`, `cache_read_tokens`),
 * resolves workspace from transcript headers or T3 Code statev2.sqlite, and caps topics per day
 * so long multi-day sessions always record today's substantive work.
 */
function parseAntigravityTranscript(fileInfo, cache, t3WorkspaceMap = null) {
    const sig = `ag2:${fileInfo.mtimeMs}:${fileInfo.size}`;
    const cached = cache.get(fileInfo.path, sig);
    if (cached) return cached;

    // Path shape: .../brain/<conv-id>/.system_generated/logs/transcript.jsonl
    const parts = fileInfo.path.split(path.sep);
    const brainIdx = parts.lastIndexOf("brain");
    const sessionId = brainIdx >= 0 && parts[brainIdx + 1] ? parts[brainIdx + 1] : path.basename(path.dirname(fileInfo.path));
    let workspace = (t3WorkspaceMap && t3WorkspaceMap.get(sessionId)) || "";
    let lastActive = fileInfo.mtimeMs;
    const dailyBuckets = {};
    const topicsByDay = new Map();

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
                    : "";

            if (!workspace && contentStr) {
                const m = contentStr.match(/(?:Command Working Directory|Your working directory):\s*([^\n<"]+)/);
                if (m && path.isAbsolute(m[1].trim())) workspace = path.normalize(m[1].trim());
            }

            // Explicit usage (nested or Antigravity top-level fields) before falling back to conservative estimate
            let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
            const u = row.usage || row.token_usage || row.metadata?.usage;
            const hasTopLevel = row.input_tokens != null || row.output_tokens != null || row.cache_read_tokens != null || row.cache_write_tokens != null || row.cache_read_input_tokens != null;
            if (u && typeof u === "object") {
                input = num(u.input_tokens || u.prompt_tokens);
                output = num(u.output_tokens || u.completion_tokens);
                cacheRead = num(u.cache_read_input_tokens || u.cache_read_tokens || u.cached_tokens);
                cacheWrite = num(u.cache_write_input_tokens || u.cache_write_tokens);
            } else if (hasTopLevel) {
                input = num(row.input_tokens || row.prompt_tokens);
                output = num(row.output_tokens || row.completion_tokens);
                cacheRead = num(row.cache_read_tokens || row.cache_read_input_tokens || row.cached_tokens);
                cacheWrite = num(row.cache_write_tokens || row.cache_write_input_tokens);
            } else if (row.type === "PLANNER_RESPONSE" && contentStr.length > 0) {
                output = Math.max(1, Math.round(contentStr.length / 3.5));
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

            if (row.type === "USER_INPUT" && typeof row.content === "string") {
                const clean = extractRealUserText(row.content);
                if (clean.length >= 6 && !isNoiseTopicText(clean)) {
                    let dayList = topicsByDay.get(date);
                    if (!dayList) { dayList = []; topicsByDay.set(date, dayList); }
                    if (!dayList.some(x => x.text === clean)) {
                        dayList.push({ date, ts, source: "antigravity", project: workspace ? path.basename(workspace) : "", text: clean });
                        if (dayList.length > 8) dayList.shift(); // Keep latest 8 substantive topics per day
                    }
                }
            }
        }
    } catch { /* ignore */ }

    const topics = [];
    const projName = workspace ? path.basename(workspace) : "";
    for (const d of [...topicsByDay.keys()].sort().slice(-14)) {
        for (const t of topicsByDay.get(d)) {
            if (!t.project && projName) t.project = projName;
            topics.push(t);
        }
    }

    const parsed = { source: "antigravity", sessionId, workspace, lastActive, dailyBuckets, topics };
    cache.set(fileInfo.path, sig, parsed);
    return parsed;
}

/**
 * Resolve Antigravity native-thread UUID -> T3 Code project workspace_root via statev2.sqlite
 */
async function loadT3AntigravityWorkspaceMap(home, env, customPath) {
    const map = new Map();
    const dbCandidates = [
        customPath && (customPath.endsWith(".sqlite") ? customPath : path.join(customPath, "statev2.sqlite")),
        env.T3_HOME && path.join(env.T3_HOME, "userdata", "statev2.sqlite"),
        path.join(home, ".t3", "userdata", "statev2.sqlite"),
    ].filter(p => p && fs.existsSync(p));
    for (const dbPath of dbCandidates) {
        const sql = `SELECT ps.provider_thread_id, p.workspace_root AS cwd FROM orchestration_v2_projection_provider_threads ps JOIN orchestration_v2_projection_threads t ON t.thread_id = ps.thread_id LEFT JOIN projection_projects p ON p.project_id = t.project_id WHERE ps.provider = 'antigravity' AND p.workspace_root IS NOT NULL;`;
        try {
            const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-json", dbPath, sql], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
            for (const r of JSON.parse(stdout || "[]")) {
                if (typeof r.provider_thread_id !== "string" || typeof r.cwd !== "string" || !path.isAbsolute(r.cwd)) continue;
                const m = r.provider_thread_id.match(/native-thread:([0-9a-f-]{36})$/i);
                if (m) map.set(m[1], path.normalize(r.cwd));
            }
        } catch { /* ignore if schema differs */ }
    }
    return map;
}

/**
 * 4. Hermes Collector (~/.hermes/state.db & profiles/<p>/state.db via sqlite3 -readonly -json)
 * Uses per-session incremental ledger + per-day messages timestamps so resumed multi-day
 * sessions never retroactively steal tokens or topics from earlier days.
 */
async function collectHermesSessions(home, env, sinceMs, cache = null) {
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

            // Load per-day message weights for multi-day sessions (used on first-time ledger backfill)
            const msgWeightsBySession = new Map();
            try {
                const msgSql = `SELECT session_id, date(timestamp, 'unixepoch', 'localtime') AS d, COUNT(*) AS cnt, SUM(CASE WHEN role = 'assistant' THEN 1 ELSE 0 END) AS asst_cnt, SUM(COALESCE(token_count, 0)) AS tok_sum FROM messages WHERE timestamp >= ${sinceSec} GROUP BY session_id, d;`;
                const { stdout: msgOut } = await execFileAsync("sqlite3", ["-readonly", "-json", dbPath, msgSql], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 });
                for (const m of JSON.parse(msgOut || "[]")) {
                    if (!m.session_id || !m.d) continue;
                    const sid = String(m.session_id);
                    if (!msgWeightsBySession.has(sid)) msgWeightsBySession.set(sid, []);
                    const weight = num(m.tok_sum) > 0 ? num(m.tok_sum) : (num(m.asst_cnt) > 0 ? num(m.asst_cnt) : num(m.cnt));
                    if (weight > 0) msgWeightsBySession.get(sid).push({ date: String(m.d), weight });
                }
            } catch { /* older schema without messages table is fine */ }

            // Load substantive user messages for non-cron Hermes sessions so high-token chat days yield real work topics
            const msgTopicsBySession = new Map();
            try {
                const userMsgSql = `SELECT m.session_id, m.timestamp, substr(m.content, 1, 600) AS content FROM messages m WHERE m.role = 'user' AND m.timestamp >= ${sinceSec} AND m.session_id NOT LIKE 'cron_%' AND length(COALESCE(m.content, '')) >= 12 ORDER BY m.timestamp DESC LIMIT 600;`;
                const { stdout: umOut } = await execFileAsync("sqlite3", ["-readonly", "-json", dbPath, userMsgSql], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 });
                for (const um of JSON.parse(umOut || "[]")) {
                    const sid = String(um.session_id || "");
                    if (!sid || !um.content) continue;
                    const clean = extractRealUserText(String(um.content));
                    if (!clean || isNoiseTopicText(clean, { sessionId: sid })) continue;
                    const rawTs = num(um.timestamp);
                    const tsMs = rawTs > 1e12 ? rawTs : rawTs * 1000;
                    if (!tsMs) continue;
                    const d = localDateKey(tsMs);
                    if (!msgTopicsBySession.has(sid)) msgTopicsBySession.set(sid, new Map());
                    const byDay = msgTopicsBySession.get(sid);
                    if (!byDay.has(d)) byDay.set(d, []);
                    const list = byDay.get(d);
                    if (list.length < 4 && !list.some(x => x.text === clean)) {
                        list.push({ date: d, ts: tsMs, text: clean });
                    }
                }
            } catch { /* ignore if schema differs */ }

            for (const r of rows) {
                const activeSec = num(r.last_activity_at || r.ended_at || r.started_at);
                const activeTs = activeSec > 1e12 ? activeSec : activeSec * 1000;
                const startSec = num(r.started_at || activeSec);
                const startTs = startSec > 1e12 ? startSec : startSec * 1000;
                if (!activeTs) continue;
                const activeDate = localDateKey(activeTs);
                const startDate = startTs ? localDateKey(startTs) : activeDate;
                const input = num(r.input_tokens);
                const output = num(r.output_tokens);
                const cacheRead = num(r.cache_read_tokens);
                const cacheWrite = num(r.cache_write_tokens);
                const tokens = input + output + cacheRead + cacheWrite;
                const workspace = typeof r.cwd === "string" && path.isAbsolute(r.cwd) ? path.normalize(r.cwd) : "";
                const sid = String(r.id);
                const ledgerKey = `hermes:${dbPath}:${sid}`;
                const dailyBuckets = allocateCumulativeSessionBuckets(
                    cache,
                    ledgerKey,
                    { input, output, cacheRead, cacheWrite, tokens },
                    activeDate,
                    msgWeightsBySession.get(sid) || null
                );

                // Extract substantive non-cron topics: prefer real user messages per day, plus clean non-noise title anchored to creation date
                const topics = [];
                const proj = workspace ? path.basename(workspace) : "";
                const isCron = /^cron_/i.test(sid);
                if (!isCron) {
                    if (r.title) {
                        const cleanTitle = sanitizeTopic(r.title, 180);
                        if (cleanTitle && !isNoiseTopicText(cleanTitle, { sessionId: sid })) {
                            topics.push({ date: startDate, ts: startTs || activeTs, source: "hermes", project: proj, text: cleanTitle });
                            if (activeDate !== startDate) {
                                topics.push({ date: activeDate, ts: activeTs, source: "hermes", project: proj, text: cleanTitle });
                            }
                        }
                    }
                    const sessionMsgs = msgTopicsBySession.get(sid);
                    if (sessionMsgs) {
                        for (const [, dayEntries] of sessionMsgs.entries()) {
                            for (const m of dayEntries) {
                                if (!topics.some(t => t.date === m.date && t.text === m.text)) {
                                    topics.push({ date: m.date, ts: m.ts, source: "hermes", project: proj, text: m.text });
                                }
                            }
                        }
                    }
                }
                sessions.push({
                    source: "hermes",
                    sessionId: sid,
                    workspace,
                    lastActive: activeTs,
                    dailyBuckets,
                    topics,
                });
            }
        } catch { /* sqlite3 unavailable or locked */ }
    }
    return { paths: existingDbs, sessions };
}

/**
 * 5. DSH Collector (~/.dsh/sessions/** /session*.jsonl(.zstd))
 * Supports concatenated multi-frame ZSTD logs and DSH v4 event schemas (`assistant/message` + `data.usage`, `user/message`).
 */
function parseDshFile(fileInfo, cache) {
    const sig = `dsh2:${fileInfo.mtimeMs}:${fileInfo.size}`;
    const cached = cache.get(fileInfo.path, sig);
    if (cached) return cached;

    const sessDir = path.dirname(fileInfo.path);
    const slugDir = path.basename(path.dirname(sessDir));
    const sessionId = path.basename(sessDir);
    let workspace = decodeDshWorkspaceSlug(slugDir);
    let lastActive = fileInfo.mtimeMs;
    const dailyBuckets = {};
    const topicsByDay = new Map();

    try {
        const raw = fileInfo.path.endsWith(".zstd")
            ? decompressZstdSync(fs.readFileSync(fileInfo.path))
            : fs.readFileSync(fileInfo.path, "utf8");
        for (const line of raw.split("\n")) {
            if (!line || line[0] !== "{") continue;
            let row;
            try { row = JSON.parse(line); } catch { continue; }
            const rawTs = row.time || row.timestamp || row.createdAt || row.ts;
            const ts = typeof rawTs === "number" ? (rawTs < 1e12 ? rawTs * 1000 : rawTs) : (Date.parse(rawTs || "") || fileInfo.mtimeMs);
            if (ts > lastActive) lastActive = ts;
            if (!workspace && typeof row.cwd === "string" && path.isAbsolute(row.cwd)) workspace = path.normalize(row.cwd);

            const u = row.data?.usage || row.usage || row.message?.usage || row.payload?.usage || row.data?.message?.usage;
            if (u && typeof u === "object") {
                const input = num(u.inputTokens || u.input_tokens || u.promptTokens || u.prompt_tokens || u.input);
                const output = num(u.outputTokens || u.output_tokens || u.completionTokens || u.completion_tokens || u.output);
                const cacheRead = num(u.cachedInputTokens || u.cacheReadInputTokens || u.cacheReadTokens || u.cache_read_input_tokens || u.prompt_cache_hit_tokens || u.cacheRead);
                const cacheWrite = num(u.cacheCreationInputTokens || u.cacheWriteTokens || u.cache_creation_input_tokens || u.cacheWrite);
                const rawSum = input + output + cacheRead + cacheWrite;
                const tokens = rawSum > 0 ? rawSum : num(u.totalTokens || u.total_tokens || u.total);
                if (tokens > 0) {
                    const date = localDateKey(ts);
                    const b = dailyBuckets[date] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0 };
                    b.input += input || (rawSum === 0 ? tokens : 0);
                    b.output += output;
                    b.cacheRead += cacheRead;
                    b.cacheWrite += cacheWrite;
                    b.tokens += tokens;
                    dailyBuckets[date] = b;
                }
            }
            if (row.type === "user/message" || row.role === "user" || row.type === "user") {
                const rawContent = row.data?.content ?? row.content ?? row.text;
                const txt = typeof rawContent === "string"
                    ? rawContent
                    : Array.isArray(rawContent)
                        ? rawContent.map(c => (typeof c === "string" ? c : c?.text || "")).join(" ")
                        : "";
                const clean = extractRealUserText(txt);
                if (clean.length >= 6 && !isNoiseTopicText(clean)) {
                    const date = localDateKey(ts);
                    let list = topicsByDay.get(date);
                    if (!list) { list = []; topicsByDay.set(date, list); }
                    if (!list.some(x => x.text === clean)) {
                        list.push({ date, ts, source: "dsh", project: workspace ? path.basename(workspace) : "", text: clean });
                        if (list.length > 8) list.shift();
                    }
                }
            }
        }
    } catch { /* ignore corrupted/zstd unsupported */ }

    const topics = [];
    const projName = workspace ? path.basename(workspace) : "";
    for (const d of [...topicsByDay.keys()].sort().slice(-14)) {
        for (const t of topicsByDay.get(d)) {
            if (!t.project && projName) t.project = projName;
            topics.push(t);
        }
    }

    const parsed = { source: "dsh", sessionId, workspace, lastActive, dailyBuckets, topics };
    cache.set(fileInfo.path, sig, parsed);
    return parsed;
}

/**
 * 6. WorkBuddy Collector (~/.workbuddy-ai/workbuddy.db + ~/.workbuddy)
 */
async function collectWorkBuddySessions(home, env, customPath, sinceMs, cache = null) {
    const dbCandidates = [
        customPath && (customPath.endsWith(".db") ? customPath : path.join(customPath, "workbuddy.db")),
        env.WORKBUDDY_HOME && path.join(env.WORKBUDDY_HOME, "workbuddy.db"),
        path.join(home, ".workbuddy-ai", "workbuddy.db"),
        path.join(home, ".workbuddy", "workbuddy.db"),
    ].filter(p => p && fs.existsSync(p));
    const sessions = [];

    for (const dbPath of dbCandidates) {
        const sql = `SELECT s.id, s.cwd, COALESCE(NULLIF(s.custom_title,''), s.title) AS title, s.created_at, COALESCE(s.last_activity_at, s.updated_at, s.created_at) AS ts, COALESCE(u.used, 0) AS used_tokens FROM sessions s LEFT JOIN session_usage u ON u.session_id = s.id WHERE s.deleted_at IS NULL ORDER BY ts DESC LIMIT 500;`;
        try {
            const { stdout } = await execFileAsync("sqlite3", ["-readonly", "-json", dbPath, sql], { timeout: 8000, maxBuffer: 8 * 1024 * 1024 });
            const rows = JSON.parse(stdout || "[]");
            for (const r of rows) {
                const rawTs = num(r.ts);
                const ts = rawTs > 1e12 ? rawTs : rawTs * 1000;
                if (!ts || ts < sinceMs) continue;
                const rawStart = num(r.created_at || r.ts);
                const startTs = rawStart > 1e12 ? rawStart : rawStart * 1000;
                const activeDate = localDateKey(ts);
                const startDate = startTs ? localDateKey(startTs) : activeDate;
                const tokens = num(r.used_tokens);
                const workspace = typeof r.cwd === "string" && path.isAbsolute(r.cwd) ? path.normalize(r.cwd) : "";
                const sid = String(r.id);
                const dailyBuckets = allocateCumulativeSessionBuckets(
                    cache,
                    `workbuddy:${dbPath}:${sid}`,
                    { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, tokens },
                    activeDate
                );
                const topics = [];
                if (r.title) {
                    const clean = sanitizeTopic(r.title, 180);
                    if (clean) {
                        const proj = workspace ? path.basename(workspace) : "";
                        topics.push({ date: startDate, ts: startTs || ts, source: "workbuddy", project: proj, text: clean });
                        if (activeDate !== startDate) {
                            topics.push({ date: activeDate, ts, source: "workbuddy", project: proj, text: clean });
                        }
                    }
                }
                sessions.push({
                    source: "workbuddy",
                    sessionId: sid,
                    workspace,
                    lastActive: ts,
                    dailyBuckets,
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
            const startTs = Date.parse(r.created_at || "") || ts;
            const activeDate = localDateKey(ts);
            const startDate = localDateKey(startTs);
            const workspace = typeof r.cwd === "string" && path.isAbsolute(r.cwd) ? path.normalize(r.cwd) : "";
            const title = sanitizeTopic(r.title || "", 180);
            const topics = [];
            if (title && title !== "New thread") {
                const proj = workspace ? path.basename(workspace) : "";
                topics.push({ date: startDate, ts: startTs, source: "t3code", project: proj, text: title });
                if (activeDate !== startDate) {
                    topics.push({ date: activeDate, ts, source: "t3code", project: proj, text: title });
                }
            }
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
    const t3WorkspaceMap = await loadT3AntigravityWorkspaceMap(home, env, customPaths.t3code);
    const agRoots = [
        customPaths.antigravity,
        path.join(home, ".t3", "userdata", "providers", "antigravity"),
        path.join(home, ".gemini", "antigravity", "brain"),
    ].filter(p => p && fs.existsSync(p));
    const agFiles = [];
    for (const root of agRoots) {
        agFiles.push(...walkFiles(root, name => name === "transcript.jsonl", { maxDepth: 6, maxFiles: 250, minMtimeMs }));
    }
    const agSessions = agFiles.map(f => parseAntigravityTranscript(f, cache, t3WorkspaceMap));
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
    const hermesRes = await collectHermesSessions(home, env, minMtimeMs, cache);
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
    const wbRes = await collectWorkBuddySessions(home, env, customPaths.workbuddy, minMtimeMs, cache);
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

    const todayKey = localDateKey(now);
    const weekStart = localDateKey(now - 6 * 86400_000);
    const topicsByDate = new Map();
    const allDailyTokens = {};
    for (const sess of allSessions) {
        for (const [d, b] of Object.entries(sess.dailyBuckets || {})) {
            if (b?.tokens > 0) allDailyTokens[d] = (allDailyTokens[d] || 0) + b.tokens;
        }
        for (const t of sess.topics || []) {
            if (!topicsByDate.has(t.date)) topicsByDate.set(t.date, []);
            const list = topicsByDate.get(t.date);
            if (list.length < 30 && !list.some(x => x.text === t.text)) list.push(t);
        }
    }

    // Persist compact unified 8-tool summary (including Hermes/WorkBuddy/T3 Code) for standalone CLI fallback
    const recentTopicObj = {};
    for (const d of [...topicsByDate.keys()].sort().slice(-30)) {
        recentTopicObj[d] = topicsByDate.get(d).slice(0, 25);
    }
    cache.setNativeSummary({
        updatedAt: now,
        dailyTokens: allDailyTokens,
        topicsByDate: recentTopicObj,
    });
    cache.flush();

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
    createFileCache,
    allocateCumulativeSessionBuckets,
    parseCodexFile,
    parseDshFile,
    parseAntigravityTranscript,
    loadT3AntigravityWorkspaceMap,
    extractRealUserText,
    isNoiseTopicText,
    localDateKey,
};
