"use strict";

/**
 * QLEX Cognitive Memory Engine (Zero-Dependency Core)
 *
 * Synthesizes 6 memory & context architectures into one local-first filesystem engine:
 *  - Mem0: Atomic memory extraction, multi-scope (user/project/agent/session), ADD/UPDATE/SUPERSEDE/NOOP conflict resolution
 *  - Hindsight: Biomimetic Retain -> Recall -> Reflect loop + cognitive banks (world, experience, opinion, observation, mental_model)
 *  - memU: 3-layer hierarchical filesystem (resources/ -> items/ -> categories/)
 *  - Cognee: Knowledge Graph extraction (Entity nodes + Relation edges + Source provenance)
 *  - Graphiti: Bi-temporal Knowledge Graph (validFrom, validTo, recordedAt, supersededBy, point-in-time `asOf` queries)
 *  - OpenViking: Virtual context filesystem (`qlex://` URIs) + L0 / L1 / L2 tiered progressive loading
 *  - Daily / Weekly / Monthly automatic compressed archives (.md + .json.gz) in the same unified directory
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { createHash, randomUUID } = require("node:crypto");
const { homedir } = require("node:os");

const ENGINE_VERSION = "3.0.0";
const VALID_BANKS = new Set(["world", "experience", "opinion", "observation", "mental_model"]);
const VALID_SCOPES = new Set(["user", "project", "agent", "session"]);
const VALID_LEVELS = new Set(["L0", "L1", "L2"]);
const VALID_TIERS = new Set(["working", "episodic", "semantic", "procedural"]);
const VALID_LAYERS = new Set(["all", "memory", "observation", "lesson"]);
const VALID_FORMATS = new Set(["compact", "narrative", "full"]);
const VALID_ORIGIN_CHANNELS = new Set(["user", "agent", "tool", "import", "shared"]);
const SINGLE_VALUED_PREDICATES = new Set([
    "uses_framework",
    "uses_theme",
    "default_mode",
    "prefers_style",
    "deployed_at",
    "primary_language",
    "archive_dir",
    "decided_strategy",
]);

const DEFAULT_DECAY = Object.freeze({
    lambda: 0.01,
    sigma: 0.25,
    tierThresholds: { hot: 0.70, warm: 0.40, cold: 0.15 },
});

const ACCESS_RECENT_CAP = 20;
const MS_PER_DAY = 86_400_000;

const QUERY_SYNONYMS = {
    "穿透": ["tailscale", "tsnet", "nat"],
    "tailscale": ["穿透", "tsnet"],
    "记忆": ["memory", "recall", "retain"],
    "memory": ["记忆", "归档"],
    "图谱": ["graph", "entity", "关系"],
    "graph": ["图谱", "实体"],
    "同步": ["sync", "双向"],
    "sync": ["同步"],
    "修复": ["fix", "bug", "排错"],
    "fix": ["修复", "bug"],
    "bug": ["修复", "报错", "排错"],
    "技能": ["skill", "skills"],
    "skill": ["技能"],
    "部署": ["deploy", "install"],
    "deploy": ["部署"],
    "冲突": ["conflict", "supersede"],
    "conflict": ["冲突"],
    "偏好": ["preference", "opinion", "风格"],
    "架构": ["architecture", "decision", "设计"],
    "打包": ["build", "package", "release"],
};

const SOURCE_NAMES = {
    antigravity: "Antigravity",
    codex: "Codex",
    claude: "Claude Code",
    hermes: "Hermes",
    dsh: "DSH",
    workbuddy: "WorkBuddy",
    zcode: "ZCode",
    t3code: "T3 Code",
    user: "User",
    agent: "Agent",
    system: "System",
};

const PRIVATE_TAG_PATTERN = /<private>[\s\S]*?<\/private>/gi;
const SECRET_PATTERN = /(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{30,}|Bearer\s+[A-Za-z0-9._-]{16,}|(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*["']?[^\s"',;]{6,}["']?|-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----)/gi;

const KNOWN_TECH_PATTERNS = [
    ["Electron", /\belectron\b/i, "technology"],
    ["Node.js", /\bnode(?:\.js|js)?\b/i, "technology"],
    ["TypeScript", /\btypescript\b/i, "technology"],
    ["JavaScript", /\bjavascript\b/i, "technology"],
    ["Python", /\bpython\b/i, "technology"],
    ["React", /\breact\b/i, "technology"],
    ["Next.js", /\bnext\.?js\b/i, "technology"],
    ["Swift", /\bswift\b/i, "technology"],
    ["Rust", /\brust\b/i, "technology"],
    ["SQLite", /\bsqlite\b/i, "technology"],
    ["Docker", /\bdocker\b/i, "technology"],
    ["macOS", /\bmacos\b/i, "technology"],
    ["Liquid Glass", /liquid\s*glass|液态玻璃|NSGlassEffectView/i, "technology"],
    ["Vibrancy", /\bvibrancy\b|NSVisualEffectView|毛玻璃/i, "technology"],
    ["Codex", /\bcodex\b/i, "tool"],
    ["Claude Code", /\bclaude(?:\s*code)?\b/i, "tool"],
    ["Antigravity", /\bantigravity\b/i, "tool"],
    ["Hermes", /\bhermes\b/i, "tool"],
    ["DSH", /\bdsh\b/i, "tool"],
    ["QLEX", /\bqlex\b/i, "project"],
    ["Mem0", /\bmem0\b/i, "concept"],
    ["Hindsight", /\bhindsight\b/i, "concept"],
    ["memU", /\bmemu\b/i, "concept"],
    ["Cognee", /\bcognee\b/i, "concept"],
    ["Graphiti", /\bgraphiti\b/i, "concept"],
    ["OpenViking", /\bopenviking\b/i, "concept"],
    ["ZenTao", /\bzentao\b|禅道/i, "tool"],
    ["Git", /\bgit\b/i, "tool"],
    ["MCP", /\bmcp\b/i, "concept"],
];

const STOPWORDS = new Set([
    "the", "and", "for", "with", "that", "this", "from", "into", "your", "have", "will", "not", "are", "was", "were",
    "been", "can", "could", "should", "would", "use", "using", "used", "about", "what", "when", "where", "how",
    "的", "了", "在", "是", "和", "与", "把", "将", "对", "为", "以", "及", "或", "也", "都", "就", "还", "一个", "我们", "进行", "需要",
]);

function scrubSecrets(text) {
    if (typeof text !== "string") return "";
    return text
        .replace(PRIVATE_TAG_PATTERN, "[PRIVATE_REDACTED]")
        .replace(SECRET_PATTERN, "[REDACTED]");
}

function sanitizeSnippet(text, maxLen = 180) {
    return scrubSecrets(text)
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxLen);
}

function slugify(name) {
    const clean = String(name || "general")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff._-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return clean.slice(0, 64) || "general";
}

function localDateKey(ts = Date.now()) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoWeekKey(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dayNum = dt.getUTCDay() || 7;
    dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
    return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function monthKey(dateStr) {
    return dateStr.slice(0, 7);
}

function parseTimestamp(value, fallback = null) {
    if (value == null || value === "") return fallback;
    if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
    const str = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
        // End of day local/UTC inclusive when querying `asOf`
        const parsed = Date.parse(`${str}T23:59:59.999Z`);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    const parsed = Date.parse(str);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function fmtNum(v) {
    return new Intl.NumberFormat("zh-CN").format(Math.round(v || 0));
}

function fmtIsoShort(ts) {
    if (!ts) return "—";
    try {
        const d = new Date(ts);
        if (!Number.isFinite(d.getTime())) return "—";
        const pad = (n) => String(n).padStart(2, "0");
        const offsetMin = -d.getTimezoneOffset();
        const sign = offsetMin >= 0 ? "+" : "-";
        const absMin = Math.abs(offsetMin);
        const tz = `UTC${sign}${pad(Math.floor(absMin / 60))}:${pad(absMin % 60)}`;
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} (${tz})`;
    } catch {
        return "—";
    }
}

function writeAtomic(filePath, content) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o755 });
    const tmp = `${filePath}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(tmp, content);
        fs.renameSync(tmp, filePath);
    } finally {
        fs.rmSync(tmp, { force: true });
    }
}

function readJsonSafe(filePath, fallback) {
    try {
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
        return fallback;
    }
}

function readGzJsonSafe(filePath, fallback) {
    try {
        const raw = zlib.gunzipSync(fs.readFileSync(filePath));
        return JSON.parse(raw.toString("utf8"));
    } catch {
        return fallback;
    }
}

function writeGzJson(filePath, payload) {
    const rawBuf = Buffer.from(JSON.stringify(payload), "utf8");
    const gzBuf = zlib.gzipSync(rawBuf, { level: 9 });
    writeAtomic(filePath, gzBuf);
    return { rawBytes: rawBuf.length, compressedBytes: gzBuf.length };
}

/**
 * Bilingual tokenizer (Latin words + CJK unigrams & bigrams) for lexical search & deduplication
 */
function tokenize(text) {
    const clean = scrubSecrets(String(text || "")).toLowerCase();
    const tokens = [];
    // Latin / numeric / hyphenated terms
    const latinMatches = clean.match(/[a-z0-9][a-z0-9._/-]{1,40}/g) || [];
    for (const m of latinMatches) {
        if (!STOPWORDS.has(m)) tokens.push(m);
        if (m.includes("/") || m.includes("-") || m.includes("_") || m.includes(".")) {
            for (const part of m.split(/[\/._-]+/)) {
                if (part.length >= 2 && !STOPWORDS.has(part)) tokens.push(part);
            }
        }
    }
    // CJK character sequences -> bigrams + individual chars for short phrases
    const cjkRuns = clean.match(/[\u4e00-\u9fff]+/g) || [];
    for (const run of cjkRuns) {
        if (run.length === 1) {
            if (!STOPWORDS.has(run)) tokens.push(run);
            continue;
        }
        for (let i = 0; i < run.length - 1; i++) {
            const bg = run.slice(i, i + 2);
            if (!STOPWORDS.has(bg)) tokens.push(bg);
        }
    }
    return tokens;
}

function jaccardSimilarity(tokensA, tokensB) {
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);
    if (!setA.size || !setB.size) return 0;
    let inter = 0;
    for (const t of setA) if (setB.has(t)) inter++;
    const union = setA.size + setB.size - inter;
    return union > 0 ? inter / union : 0;
}

/**
 * Hindsight cognitive bank classifier
 */
function classifyBank(text, category = "") {
    const s = `${category} ${text}`.toLowerCase();
    if (/mental_model|心智模型|画像|profile/.test(s)) return "mental_model";
    if (/observation|反思|总结|规律|洞察|pattern|insight/.test(s)) return "observation";
    if (/preference|opinion|偏好|喜欢|不喜欢|习惯|风格|尽量|不要用|默认使用|prefer|dislike|always\s+use|avoid\s+using|favorite/.test(s)) return "opinion";
    if (/experience|lesson|fix|bug|error|踩坑|修复|解决|排错|经验|教训|workaround|debug|resolved|incident/.test(s)) return "experience";
    return "world";
}

function classifyCategory(bank, text, project) {
    const s = String(text || "").toLowerCase();
    if (bank === "opinion") return "preferences";
    if (bank === "experience") return "experiences";
    if (bank === "observation" || bank === "mental_model") return "observations";
    if (/决定|决策|方案|架构|重构|选用|采用|切换|改为|decided|decision|architecture|refactor|adopt|migrate/.test(s)) return "decisions";
    if (project) return `projects/${slugify(project)}`;
    return "facts";
}

function detectSupersedeSignal(text) {
    return /(?:改用|改为|换成|替换|不再使用|弃用|放弃|迁移到|升级到|改为默认|switched\s+(?:from|to)|replaced|instead\s+of|no\s+longer|deprecated|migrated\s+to|changed\s+from)/i.test(String(text || ""));
}

function classifyTier(bank, category = "", scope = "", memoryType = "") {
    if (memoryType === "lesson" || bank === "experience" || bank === "mental_model") return "procedural";
    if (bank === "opinion" || category === "decisions" || category === "preferences" || bank === "world") return "semantic";
    if (bank === "observation" || category === "observations") return "episodic";
    if (scope === "session") return "working";
    return "semantic";
}

function resolveMemoryLayer(item) {
    if (!item) return "memory";
    if (item.memoryType === "lesson" || (item.bank === "experience" && item.tier === "procedural")) return "lesson";
    if (item.bank === "observation" || item.bank === "mental_model" || item.originChannel === "import" || item.originChannel === "tool") {
        return "observation";
    }
    return "memory";
}

function normalizeAccessLog(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const recent = Array.isArray(r.recent)
        ? r.recent.filter(x => typeof x === "number" && Number.isFinite(x)).slice(-ACCESS_RECENT_CAP)
        : [];
    const count = Math.max(recent.length, Number.isFinite(Number(r.count)) ? Math.max(0, Math.floor(Number(r.count))) : 0);
    const lastAt = Number.isFinite(Number(r.lastAt)) ? Number(r.lastAt) : (recent.at(-1) || 0);
    return { count, lastAt, recent };
}

function computeItemSalience(item) {
    const conf = Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0.8;
    const bankBonus = item?.bank === "mental_model" ? 0.12 : item?.bank === "opinion" ? 0.08 : item?.bank === "experience" ? 0.06 : 0;
    const reinforceBonus = Math.min(0.15, (Number(item?.reinforcements) || 0) * 0.03);
    const evidenceBonus = Math.min(0.08, (Array.isArray(item?.evidence) ? item.evidence.length : 0) * 0.015);
    return Math.min(1, Math.max(0.2, conf * 0.82 + bankBonus + reinforceBonus + evidenceBonus));
}

function computeRetention(item, now = Date.now(), config = DEFAULT_DECAY) {
    const createdTs = Number(item?.updatedAt || item?.recordedAt || now);
    const ageDays = Math.max(0, (now - createdTs) / MS_PER_DAY);
    const salience = computeItemSalience(item);
    const temporalDecay = Math.exp(-config.lambda * ageDays);
    const log = normalizeAccessLog(item?.accessLog);
    let boost = 0;
    for (const ts of log.recent) {
        const daysSince = Math.max(0.5, (now - ts) / MS_PER_DAY);
        boost += 1 / daysSince;
    }
    const retentionScore = Number(Math.min(1, salience * temporalDecay + boost * config.sigma).toFixed(3));
    const t = config.tierThresholds || DEFAULT_DECAY.tierThresholds;
    const temperature = retentionScore >= t.hot ? "hot"
        : retentionScore >= t.warm ? "warm"
            : retentionScore >= t.cold ? "cold"
                : "dormant";
    return { retentionScore, temperature, ageDays: Number(ageDays.toFixed(1)), accessCount: log.count };
}

function estimateTokens(value) {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    return Math.max(1, Math.ceil(Buffer.byteLength(str, "utf8") / 3));
}

function expandQueryTokens(tokens) {
    const expanded = new Set(tokens);
    for (const t of tokens) {
        const syns = QUERY_SYNONYMS[t];
        if (syns) {
            for (const s of syns) expanded.add(s);
        }
    }
    return [...expanded];
}

/**
 * OpenViking L0 / L1 / L2 Progressive Layer Generator
 */
function buildLayeredContent({ title, content, l0, l1, l2 }) {
    const cleanFull = scrubSecrets(String(l2 || content || title || "")).trim();
    const cleanTitle = sanitizeSnippet(title || cleanFull.split(/[。\n.!?]/)[0] || "未命名记忆", 90);
    const derivedL0 = sanitizeSnippet(l0 || (cleanTitle && cleanFull.startsWith(cleanTitle) ? cleanFull : `${cleanTitle}${cleanFull && cleanFull !== cleanTitle ? "：" + cleanFull : ""}`), 160);
    const derivedL1 = scrubSecrets(String(l1 || "")).trim()
        || (cleanFull.length <= 420 ? cleanFull : `${cleanTitle}\n${cleanFull.slice(0, 380).trim()}…`);
    return {
        title: cleanTitle,
        l0: derivedL0,
        l1: derivedL1.slice(0, 1200),
        l2: cleanFull.slice(0, 12000),
    };
}

/**
 * Cognee + Graphiti Entity & Relation Extraction
 */
function extractEntitiesAndTriples(item) {
    const entities = [];
    const seenEnt = new Set();
    const addEntity = (name, type) => {
        const clean = sanitizeSnippet(name, 64);
        if (!clean || clean.length < 2) return null;
        const id = `${type}:${slugify(clean)}`;
        if (!seenEnt.has(id)) {
            seenEnt.add(id);
            entities.push({ id, name: clean, type });
        }
        return id;
    };

    const triples = [];
    const text = `${item.title}\n${item.l1}\n${item.l2}`;

    const subjectEntity = item.project
        ? addEntity(item.project, "project")
        : addEntity(item.scope === "user" ? "User" : (item.agent || "Workspace"), item.scope === "user" ? "person" : "concept");

    if (item.source && SOURCE_NAMES[item.source] && item.source !== "user" && item.source !== "system") {
        const toolId = addEntity(SOURCE_NAMES[item.source], "tool");
        if (subjectEntity && toolId && subjectEntity !== toolId) {
            triples.push({ subjectId: subjectEntity, predicate: "uses_tool", objectId: toolId, factKey: "" });
        }
    }

    for (const [label, regex, type] of KNOWN_TECH_PATTERNS) {
        if (regex.test(text)) {
            const eid = addEntity(label, type);
            if (subjectEntity && eid && subjectEntity !== eid) {
                const pred = item.bank === "opinion" ? "prefers"
                    : item.bank === "experience" ? "experienced_with"
                    : type === "tool" ? "uses_tool"
                    : "relates_to";
                triples.push({ subjectId: subjectEntity, predicate: pred, objectId: eid, factKey: "" });
            }
        }
    }

    // Extract explicit file references (e.g., memory-core.js, SKILL.md, package.json)
    const fileRefs = text.match(/\b[A-Za-z0-9._-]+\.(?:js|mjs|cjs|ts|tsx|py|md|json|sh|css|html|swift|rs|yaml|yml)\b/g) || [];
    for (const f of fileRefs.slice(0, 6)) {
        const fid = addEntity(f, "file");
        if (subjectEntity && fid) {
            triples.push({ subjectId: subjectEntity, predicate: "references_file", objectId: fid, factKey: "" });
        }
    }

    // Extract structured Chinese/English decision/switch patterns: "从 A 改用/切换到 B" or "switched from A to B"
    const switchZh = text.match(/(?:从|由)\s*([A-Za-z0-9\u4e00-\u9fff._-]{2,28})\s*(?:改用|改为|切换到|换成|迁移到)\s*([A-Za-z0-9\u4e00-\u9fff._-]{2,28})/);
    if (switchZh) {
        const oldId = addEntity(switchZh[1], "concept");
        const newId = addEntity(switchZh[2], "concept");
        if (oldId && newId && oldId !== newId) {
            triples.push({ subjectId: newId, predicate: "replaces", objectId: oldId, factKey: item.factKey || "" });
            if (subjectEntity) {
                triples.push({ subjectId: subjectEntity, predicate: "uses_framework", objectId: newId, factKey: item.factKey || `${subjectEntity}:uses_framework` });
            }
        }
    }
    const switchEn = text.match(/(?:switched|migrated|moved)\s+from\s+([A-Za-z0-9._-]{2,28})\s+to\s+([A-Za-z0-9._-]{2,28})/i);
    if (switchEn) {
        const oldId = addEntity(switchEn[1], "concept");
        const newId = addEntity(switchEn[2], "concept");
        if (oldId && newId && oldId !== newId) {
            triples.push({ subjectId: newId, predicate: "replaces", objectId: oldId, factKey: item.factKey || "" });
            if (subjectEntity) {
                triples.push({ subjectId: subjectEntity, predicate: "uses_framework", objectId: newId, factKey: item.factKey || `${subjectEntity}:uses_framework` });
            }
        }
    }

    // Support explicit user/agent-provided triples: [{ subject, subjectType, predicate, object, objectType, factKey }]
    if (Array.isArray(item.explicitTriples)) {
        for (const t of item.explicitTriples.slice(0, 12)) {
            if (!t || !t.subject || !t.predicate || !t.object) continue;
            const sId = addEntity(t.subject, t.subjectType || "concept");
            const oId = addEntity(t.object, t.objectType || "concept");
            if (sId && oId) {
                triples.push({
                    subjectId: sId,
                    predicate: slugify(t.predicate).replace(/-/g, "_"),
                    objectId: oId,
                    factKey: t.factKey || item.factKey || "",
                });
            }
        }
    }

    // Deduplicate triples
    const dedup = [];
    const seenT = new Set();
    for (const t of triples) {
        const k = `${t.subjectId}|${t.predicate}|${t.objectId}`;
        if (seenT.has(k)) continue;
        seenT.add(k);
        dedup.push(t);
    }
    return { entities, triples: dedup };
}

function resolveDefaultMemoryDir(home = homedir()) {
    if (process.env.QLEX_MEMORY_DIR && process.env.QLEX_MEMORY_DIR.trim()) {
        return path.resolve(process.env.QLEX_MEMORY_DIR.trim());
    }
    const macState = path.join(home, "Library", "Application Support", "QLEX", "state.json");
    const saved = readJsonSafe(macState, null);
    if (saved && typeof saved.memoryArchiveDir === "string" && saved.memoryArchiveDir.trim()) {
        return path.resolve(saved.memoryArchiveDir.trim());
    }
    return path.join(home, "Documents", "QLEX-Memory");
}

function extractHistoryTopicsByDate(home, cacheState) {
    const candidates = [
        { source: "claude", file: path.join(home, ".claude", "history.jsonl") },
        { source: "codex", file: path.join(home, ".codex", "history.jsonl") },
    ];
    const byDate = new Map();
    let hits = 0;
    let misses = 0;
    const resources = [];

    for (const item of candidates) {
        let stat;
        try {
            stat = fs.statSync(item.file);
            if (!stat.isFile()) continue;
        } catch {
            continue;
        }
        const sig = `${stat.mtimeMs}:${stat.size}`;
        const cached = cacheState.files[item.file];
        let entries;
        if (cached && cached.sig === sig && Array.isArray(cached.entries)) {
            entries = cached.entries;
            hits++;
        } else {
            misses++;
            entries = [];
            try {
                const fd = fs.openSync(item.file, "r");
                try {
                    const len = Math.min(stat.size, 512 * 1024);
                    const buf = Buffer.alloc(len);
                    fs.readSync(fd, buf, 0, len, stat.size - len);
                    const lines = buf.toString("utf8").split("\n");
                    const seenPerDay = new Map();
                    for (const line of lines) {
                        if (!line.trim().startsWith("{")) continue;
                        try {
                            const row = JSON.parse(line);
                            const ts = Number(row.timestamp || row.ts || row.createdAt || 0);
                            const ms = ts > 0 && ts < 1e12 ? ts * 1000 : ts;
                            if (!ms || !Number.isFinite(ms)) continue;
                            const date = localDateKey(ms);
                            const text = sanitizeSnippet(row.display || row.text || row.prompt || row.message || "", 220);
                            if (!text || text.length < 4) continue;
                            const project = typeof row.project === "string" ? path.basename(row.project) : "";
                            let set = seenPerDay.get(date);
                            if (!set) { set = new Set(); seenPerDay.set(date, set); }
                            if (set.size >= 18 || set.has(text)) continue;
                            set.add(text);
                            entries.push({ date, ts: ms, source: item.source, project, text });
                        } catch { /* skip malformed line */ }
                    }
                } finally {
                    fs.closeSync(fd);
                }
            } catch { /* unreadable */ }
            cacheState.files[item.file] = { sig, entries };
        }

        resources.push({
            id: `res:${item.source}-history`,
            kind: "history_jsonl",
            source: item.source,
            path: item.file,
            sig,
            entryCount: entries.length,
            updatedAt: stat.mtimeMs,
        });

        for (const e of entries) {
            let list = byDate.get(e.date);
            if (!list) { list = []; byDate.set(e.date, list); }
            list.push(e);
        }
    }
    return { byDate, hits, misses, resources };
}

function renderDailyMarkdown(record) {
    const lines = [
        `# 每日记忆归档 · ${record.date}`,
        "",
        `- **OpenViking URI**：\`qlex://daily/${record.date}\``,
        `- **周期归类**：每日记忆 (\`daily/${record.date.slice(0, 7)}\`)`,
        `- **所属周 / 月**：${record.week} / ${record.month}`,
        `- **总计 Token**：${fmtNum(record.totalTokens)}`,
        `- **会话次数**：${fmtNum(record.totalSessions)}`,
        `- **更新时间**：${fmtIsoShort(record.updatedAt)}`,
        ...(record.settledAt ? [`- **日结状态**：已日结固定于 ${fmtIsoShort(record.settledAt)}`] : []),
        "",
    ];

    if (record.tools.length) {
        lines.push("## AI 工具分布", "");
        for (const t of record.tools) {
            lines.push(`- **${SOURCE_NAMES[t.source] || t.source}**：${fmtNum(t.tokens)} Token（${fmtNum(t.sessions)} 次会话）`);
        }
        lines.push("");
    }

    if (record.projects.length) {
        lines.push("## 活跃工作区", "");
        for (const p of record.projects.slice(0, 12)) {
            lines.push(`- **${p.name}** — ${fmtNum(p.tokens)} Token · \`${p.directory}\``);
        }
        lines.push("");
    }

    if (record.topics.length) {
        lines.push("## 压缩记忆要点", "");
        for (const item of record.topics.slice(0, 20)) {
            const tag = [SOURCE_NAMES[item.source] || item.source, item.project].filter(Boolean).join(" · ");
            lines.push(`- [${tag}] ${item.text}`);
        }
        lines.push("");
    }
    return lines.join("\n");
}

function renderPeriodMarkdown(kind, key, children, summary) {
    const title = kind === "weekly" ? `每周记忆压缩归档 · ${key}` : `每月记忆压缩归档 · ${key}`;
    const lines = [
        `# ${title}`,
        "",
        `- **OpenViking URI**：\`qlex://${kind}/${key}\``,
        `- **周期归类**：${kind === "weekly" ? "每周记忆 (`weekly/`)" : "每月记忆 (`monthly/`)"}`,
        `- **覆盖天数**：${children.length} 天（${children[0]?.date || "—"} ~ ${children.at(-1)?.date || "—"}）`,
        `- **累计 Token**：${fmtNum(summary.totalTokens)}`,
        `- **累计会话**：${fmtNum(summary.totalSessions)}`,
        `- **归档生成**：${fmtIsoShort(summary.updatedAt)}`,
        "",
    ];
    if (summary.topTools.length) {
        lines.push("## 主要 AI 工具", "");
        for (const t of summary.topTools) {
            lines.push(`- **${SOURCE_NAMES[t.source] || t.source}**：${fmtNum(t.tokens)} Token`);
        }
        lines.push("");
    }
    if (summary.topProjects.length) {
        lines.push("## 高频项目", "");
        for (const p of summary.topProjects.slice(0, 10)) {
            lines.push(`- **${p.name}**：${fmtNum(p.tokens)} Token（活跃 ${p.days} 天）`);
        }
        lines.push("");
    }
    if (summary.highlights.length) {
        lines.push("## 周期核心记忆摘要", "");
        for (const h of summary.highlights.slice(0, 24)) {
            lines.push(`- **${h.date}** ${h.text}`);
        }
        lines.push("");
    }
    lines.push("## 每日索引", "");
    for (const day of children) {
        lines.push(`- \`${day.date}\` · ${fmtNum(day.totalTokens)} Token · ${day.projects.length} 工作区 · ${day.topics.length} 条要点`);
    }
    lines.push("");
    return lines.join("\n");
}

function rollupRecords(kind, key, days) {
    const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
    let totalTokens = 0;
    let totalSessions = 0;
    const toolMap = new Map();
    const projectMap = new Map();
    const highlights = [];
    const seenTopic = new Set();

    for (const day of ordered) {
        totalTokens += day.totalTokens || 0;
        totalSessions += day.totalSessions || 0;
        for (const t of day.tools || []) {
            toolMap.set(t.source, (toolMap.get(t.source) || 0) + (t.tokens || 0));
        }
        for (const p of day.projects || []) {
            const prev = projectMap.get(p.directory) || { name: p.name, directory: p.directory, tokens: 0, days: 0 };
            prev.tokens += p.tokens || 0;
            prev.days += 1;
            projectMap.set(p.directory, prev);
        }
        for (const topic of (day.topics || []).slice(0, 4)) {
            const norm = topic.text.toLowerCase();
            if (seenTopic.has(norm)) continue;
            seenTopic.add(norm);
            highlights.push({ date: day.date, source: topic.source, text: topic.text });
        }
    }

    const summary = {
        kind,
        key,
        days: ordered.map(d => d.date),
        totalTokens,
        totalSessions,
        topTools: [...toolMap.entries()].map(([source, tokens]) => ({ source, tokens })).sort((a, b) => b.tokens - a.tokens),
        topProjects: [...projectMap.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 12),
        highlights: highlights.slice(0, 30),
        updatedAt: Date.now(),
    };
    return { summary, ordered };
}

/**
 * Create a Cognitive Memory Engine bound to a root directory (works in Electron & standalone CLI)
 */
function createCognitiveMemoryEngine({ getArchiveDir, getProjects, getUsageSnapshot, getTopicsByDate, home = homedir() } = {}) {
    const resolveRoot = () => (typeof getArchiveDir === "function" ? getArchiveDir() : resolveDefaultMemoryDir(home));

    function pathsOf(root = resolveRoot()) {
        return {
            root,
            indexFile: path.join(root, "index.json"),
            cacheFile: path.join(root, "cache", "digest-cache.json"),
            resourcesDir: path.join(root, "resources"),
            resourcesStore: path.join(root, "resources", "resources.json.gz"),
            itemsDir: path.join(root, "items"),
            itemsStore: path.join(root, "items", "store.json.gz"),
            itemsMd: path.join(root, "items", "items.md"),
            categoriesDir: path.join(root, "categories"),
            graphDir: path.join(root, "graph"),
            graphStore: path.join(root, "graph", "graph.json.gz"),
            graphMd: path.join(root, "graph", "graph.md"),
            reflectionsDir: path.join(root, "reflections"),
            reflectionsMd: path.join(root, "reflections", "reflections.md"),
            dailyRoot: path.join(root, "daily"),
            weeklyRoot: path.join(root, "weekly"),
            monthlyRoot: path.join(root, "monthly"),
        };
    }

    function ensureDirs(p) {
        for (const d of [p.root, path.dirname(p.cacheFile), p.resourcesDir, p.itemsDir, p.categoriesDir, path.join(p.categoriesDir, "projects"), p.graphDir, p.reflectionsDir, p.dailyRoot, p.weeklyRoot, p.monthlyRoot]) {
            fs.mkdirSync(d, { recursive: true });
        }
    }

    function loadItemStore(p = pathsOf()) {
        const data = readGzJsonSafe(p.itemsStore, null);
        if (data && Array.isArray(data.items)) return data;
        return { version: 2, updatedAt: 0, items: [] };
    }

    function saveItemStore(store, p = pathsOf()) {
        store.version = 2;
        store.updatedAt = Date.now();
        return writeGzJson(p.itemsStore, store);
    }

    function loadGraphStore(p = pathsOf()) {
        const data = readGzJsonSafe(p.graphStore, null);
        if (data && Array.isArray(data.entities) && Array.isArray(data.edges)) return data;
        return { version: 2, updatedAt: 0, entities: [], edges: [] };
    }

    function saveGraphStore(graph, p = pathsOf()) {
        graph.version = 2;
        graph.updatedAt = Date.now();
        return writeGzJson(p.graphStore, graph);
    }

    function loadResourceStore(p = pathsOf()) {
        const data = readGzJsonSafe(p.resourcesStore, null);
        if (data && Array.isArray(data.resources)) return data;
        return { version: 2, updatedAt: 0, resources: [] };
    }

    function saveResourceStore(resStore, p = pathsOf()) {
        resStore.version = 2;
        resStore.updatedAt = Date.now();
        return writeGzJson(p.resourcesStore, resStore);
    }

    function computeCognitiveStats(itemStore, graphStore) {
        const banks = { world: 0, experience: 0, opinion: 0, observation: 0, mental_model: 0 };
        const tiers = { working: 0, episodic: 0, semantic: 0, procedural: 0 };
        const temperatures = { hot: 0, warm: 0, cold: 0, dormant: 0 };
        const categories = {};
        let activeItems = 0;
        let supersededItems = 0;
        let deletedItems = 0;
        let lessonsCount = 0;
        let expiringSoon = 0;
        const now = Date.now();

        for (const it of itemStore.items) {
            if (it.status === "active") {
                activeItems++;
                if (Object.hasOwn(banks, it.bank)) banks[it.bank]++;
                const tier = VALID_TIERS.has(it.tier) ? it.tier : classifyTier(it.bank, it.category, it.scope, it.memoryType);
                tiers[tier]++;
                const ret = computeRetention(it, now);
                temperatures[ret.temperature]++;
                if (resolveMemoryLayer(it) === "lesson") lessonsCount++;
                if (it.forgetAfter && it.forgetAfter <= now + 3 * MS_PER_DAY) expiringSoon++;
                categories[it.category] = (categories[it.category] || 0) + 1;
            } else if (it.status === "superseded") {
                supersededItems++;
            } else {
                deletedItems++;
            }
        }

        const activeEdges = graphStore.edges.filter(e => !e.validTo).length;
        const historicalEdges = graphStore.edges.length - activeEdges;
        return {
            engineVersion: ENGINE_VERSION,
            activeItems,
            supersededItems,
            deletedItems,
            totalItems: itemStore.items.length,
            entities: graphStore.entities.length,
            activeEdges,
            historicalEdges,
            totalEdges: graphStore.edges.length,
            banks,
            tiers,
            temperatures,
            lessonsCount,
            expiringSoon,
            categories,
            reflectionsCount: banks.observation + banks.mental_model,
        };
    }

    /**
     * Upsert entities & bi-temporal edges into Cognee + Graphiti Knowledge Graph
     */
    function applyGraphUpdates(graphStore, item, extracted, now) {
        const entityMap = new Map(graphStore.entities.map(e => [e.id, e]));
        let entitiesAdded = 0;
        let edgesAdded = 0;
        let edgesSuperseded = 0;

        for (const ent of extracted.entities) {
            const existing = entityMap.get(ent.id);
            if (existing) {
                existing.mentions = (existing.mentions || 1) + 1;
                existing.lastSeenAt = now;
            } else {
                const created = {
                    id: ent.id,
                    name: ent.name,
                    type: ent.type,
                    mentions: 1,
                    createdAt: now,
                    lastSeenAt: now,
                };
                graphStore.entities.push(created);
                entityMap.set(created.id, created);
                entitiesAdded++;
            }
        }

        for (const tri of extracted.triples) {
            // Check exact active edge
            const exact = graphStore.edges.find(e =>
                !e.validTo && e.subjectId === tri.subjectId && e.predicate === tri.predicate && e.objectId === tri.objectId
            );
            if (exact) {
                if (!exact.evidence.includes(item.id)) exact.evidence.push(item.id);
                exact.lastConfirmedAt = now;
                exact.confidence = Math.min(1, Number(((exact.confidence || 0.8) + 0.05).toFixed(2)));
                continue;
            }

            // Graphiti bi-temporal supersession: close prior active edge for single-valued predicate or matching factKey
            const newEdgeId = `edge_${randomUUID().slice(0, 10)}`;
            const shouldSupersedePrior = SINGLE_VALUED_PREDICATES.has(tri.predicate) || Boolean(tri.factKey);
            if (shouldSupersedePrior) {
                for (const prev of graphStore.edges) {
                    if (prev.validTo) continue;
                    const sameFactKey = tri.factKey && prev.factKey && prev.factKey === tri.factKey;
                    const sameSingleSlot = SINGLE_VALUED_PREDICATES.has(tri.predicate) && prev.subjectId === tri.subjectId && prev.predicate === tri.predicate;
                    if ((sameFactKey || sameSingleSlot) && prev.objectId !== tri.objectId) {
                        prev.validTo = now;
                        prev.supersededBy = newEdgeId;
                        edgesSuperseded++;
                    }
                }
            }

            graphStore.edges.push({
                id: newEdgeId,
                subjectId: tri.subjectId,
                predicate: tri.predicate,
                objectId: tri.objectId,
                factKey: tri.factKey || "",
                validFrom: item.validFrom || now,
                validTo: null,
                recordedAt: now,
                lastConfirmedAt: now,
                supersededBy: null,
                confidence: item.confidence ?? 0.8,
                evidence: [item.id],
            });
            edgesAdded++;
        }

        return { entitiesAdded, edgesAdded, edgesSuperseded };
    }

    /**
     * Render memU Categories + OpenViking L0/L1 sidecars + Cognee/Graphiti graph.md + items.md
     */
    function materializeViews(itemStore, graphStore, p = pathsOf()) {
        ensureDirs(p);
        const active = itemStore.items.filter(i => i.status === "active").sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        const superseded = itemStore.items.filter(i => i.status === "superseded").sort((a, b) => (b.validTo || 0) - (a.validTo || 0));
        const stats = computeCognitiveStats(itemStore, graphStore);

        // 1. items/items.md
        const itemLines = [
            "# QLEX 原子记忆库 (Mem0 + Hindsight)",
            "",
            `- **活跃记忆**：${stats.activeItems} 条 · **已演进替代**：${stats.supersededItems} 条`,
            `- **认知分区**：世界事实 ${stats.banks.world} · 经验教训 ${stats.banks.experience} · 观点偏好 ${stats.banks.opinion} · 反思洞察 ${stats.banks.observation} · 心智模型 ${stats.banks.mental_model}`,
            `- **更新时间**：${fmtIsoShort(Date.now())}`,
            "",
        ];
        for (const it of active.slice(0, 120)) {
            const meta = [it.bank, it.scope, it.project || null, `v${it.version || 1}`].filter(Boolean).join(" · ");
            itemLines.push(`- \`qlex://items/${it.id}\` **[${meta}]** ${it.l0}`);
        }
        writeAtomic(p.itemsMd, itemLines.join("\n") + "\n");

        // 2. memU Layer 3: categories/ + OpenViking _abstract.md (L0) & _overview.md (L1)
        const byCategory = new Map();
        for (const it of active) {
            const cat = it.category || "facts";
            if (!byCategory.has(cat)) byCategory.set(cat, []);
            byCategory.get(cat).push(it);
        }

        const topProjects = [...new Set(active.map(i => i.project).filter(Boolean))].slice(0, 8);
        const abstractMd = [
            "# QLEX Memory Global Abstract (OpenViking L0)",
            "",
            `共沉淀 ${stats.activeItems} 条活跃原子记忆、${stats.entities} 个知识图谱实体、${stats.activeEdges} 条有效时序关系（${stats.historicalEdges} 条历史演进链），覆盖分类：${[...byCategory.keys()].join(", ") || "暂无"}。${topProjects.length ? `核心项目：${topProjects.join("、")}。` : ""}`,
        ].join("\n") + "\n";
        writeAtomic(path.join(p.categoriesDir, "_abstract.md"), abstractMd);

        const overviewLines = [
            "# QLEX Memory Global Overview (OpenViking L1)",
            "",
            `- **URI 根路径**：\`qlex://\``,
            `- **活跃记忆**：${stats.activeItems} 条（演进替代 ${stats.supersededItems} 条）`,
            `- **知识图谱**：${stats.entities} 实体 / ${stats.activeEdges} 活跃边 / ${stats.historicalEdges} 历史边`,
            "",
            "## 分类索引 (`qlex://categories/<name>`)",
            "",
        ];
        for (const [cat, list] of [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length)) {
            overviewLines.push(`### \`qlex://categories/${cat}\` (${list.length})`);
            for (const it of list.slice(0, 5)) {
                overviewLines.push(`- [\`${it.id}\`] ${it.l0}`);
            }
            overviewLines.push("");
        }
        writeAtomic(path.join(p.categoriesDir, "_overview.md"), overviewLines.join("\n") + "\n");

        const standardCats = ["preferences", "decisions", "experiences", "facts", "observations"];
        const allCats = new Set([...standardCats, ...byCategory.keys()]);
        for (const cat of allCats) {
            const list = byCategory.get(cat) || [];
            const targetFile = cat.startsWith("projects/")
                ? path.join(p.categoriesDir, "projects", `${slugify(cat.slice("projects/".length))}.md`)
                : path.join(p.categoriesDir, `${slugify(cat)}.md`);
            const catTitle = {
                preferences: "用户偏好与观点 (Opinion Bank)",
                decisions: "关键架构与决策 (Decisions)",
                experiences: "经验教训与排错 (Experience Bank)",
                facts: "客观事实与环境配置 (World Bank)",
                observations: "反思洞察与心智模型 (Hindsight Reflect)",
            }[cat] || `项目专题 · ${cat.replace(/^projects\//, "")}`;

            const lines = [
                `# ${catTitle}`,
                "",
                `- **OpenViking URI**：\`qlex://categories/${cat}\``,
                `- **条目数量**：${list.length}`,
                "",
            ];
            if (!list.length) {
                lines.push("_当前分类暂无活跃记忆。_", "");
            } else {
                for (const it of list.slice(0, 80)) {
                    lines.push(`## ${it.title}`);
                    lines.push(`- **URI**：\`qlex://items/${it.id}\` · **Bank**：${it.bank} · **Scope**：${it.scope}${it.project ? ` · **Project**：${it.project}` : ""} · **Confidence**：${Math.round((it.confidence ?? 0.8) * 100)}% · **ValidFrom**：${fmtIsoShort(it.validFrom)}`);
                    lines.push(`- **L0 摘要**：${it.l0}`);
                    if (it.l1 && it.l1 !== it.l0) {
                        lines.push("", it.l1);
                    }
                    lines.push("");
                }
            }
            writeAtomic(targetFile, lines.join("\n") + "\n");
        }

        // 3. Cognee + Graphiti: graph/graph.md
        const entMap = new Map(graphStore.entities.map(e => [e.id, e]));
        const topEntities = [...graphStore.entities].sort((a, b) => (b.mentions || 0) - (a.mentions || 0)).slice(0, 35);
        const activeEdges = graphStore.edges.filter(e => !e.validTo).slice(-60).reverse();
        const evolvedEdges = graphStore.edges.filter(e => Boolean(e.validTo)).slice(-30).reverse();

        const gLines = [
            "# QLEX 时序知识图谱 (Cognee + Graphiti)",
            "",
            `- **OpenViking URI**：\`qlex://graph\``,
            `- **实体数**：${graphStore.entities.length} · **活跃关系**：${stats.activeEdges} · **历史演进边**：${stats.historicalEdges}`,
            `- **更新时间**：${fmtIsoShort(Date.now())}`,
            "",
            "## 核心实体节点",
            "",
        ];
        if (!topEntities.length) {
            gLines.push("_暂无图谱实体。_", "");
        } else {
            for (const ent of topEntities) {
                gLines.push(`- \`qlex://entities/${slugify(ent.name)}\` **${ent.name}** (${ent.type}) · 提及 ${ent.mentions || 1} 次`);
            }
            gLines.push("");
        }

        gLines.push("## 当前有效关系 (Active Facts)", "");
        if (!activeEdges.length) {
            gLines.push("_暂无活跃关系边。_", "");
        } else {
            for (const e of activeEdges) {
                const sName = entMap.get(e.subjectId)?.name || e.subjectId;
                const oName = entMap.get(e.objectId)?.name || e.objectId;
                gLines.push(`- **${sName}** —\`${e.predicate}\`→ **${oName}** *(自 ${fmtIsoShort(e.validFrom)})*`);
            }
            gLines.push("");
        }

        if (evolvedEdges.length || superseded.length) {
            gLines.push("## 事实随时间演进链 (Graphiti Bi-Temporal Evolution)", "");
            for (const e of evolvedEdges) {
                const sName = entMap.get(e.subjectId)?.name || e.subjectId;
                const oName = entMap.get(e.objectId)?.name || e.objectId;
                gLines.push(`- ~~${sName} —\`${e.predicate}\`→ ${oName}~~ *(有效区间 ${fmtIsoShort(e.validFrom)} → ${fmtIsoShort(e.validTo)}，已被 \`${e.supersededBy || "新事实"}\` 替代)*`);
            }
            for (const oldItem of superseded.slice(0, 20)) {
                gLines.push(`- ~~${oldItem.l0}~~ *(失效于 ${fmtIsoShort(oldItem.validTo)}，替代项 \`qlex://items/${oldItem.supersededBy}\`)*`);
            }
            gLines.push("");
        }
        writeAtomic(p.graphMd, gLines.join("\n") + "\n");

        // 4. Hindsight Reflections: reflections/reflections.md
        const reflections = active.filter(i => i.bank === "observation" || i.bank === "mental_model");
        const rLines = [
            "# Hindsight 反思洞察与心智模型",
            "",
            `- **OpenViking URI**：\`qlex://reflections\``,
            `- **观察洞察 (Observation)**：${stats.banks.observation} · **心智模型 (Mental Model)**：${stats.banks.mental_model}`,
            "",
        ];
        if (!reflections.length) {
            rLines.push("_尚未生成反思洞察。调用 `reflect` 或执行记忆归档即可基于已有事实与经验自动合成。_", "");
        } else {
            for (const ref of reflections) {
                rLines.push(`## [${ref.bank === "mental_model" ? "心智模型" : "反思洞察"}] ${ref.title}`);
                rLines.push(`- **URI**：\`qlex://items/${ref.id}\` · **置信度**：${Math.round((ref.confidence ?? 0.85) * 100)}% · **证据数**：${(ref.evidence || []).length}`);
                rLines.push("", ref.l2 || ref.l1 || ref.l0, "");
            }
        }
        writeAtomic(p.reflectionsMd, rLines.join("\n") + "\n");

        return stats;
    }

    function syncIndexCognitiveStats(itemStore, graphStore, p = pathsOf()) {
        const stats = computeCognitiveStats(itemStore, graphStore);
        const existing = readJsonSafe(p.indexFile, {
            version: 2,
            archiveDir: p.root,
            lastRun: Date.now(),
            rawBytes: 0,
            compressedBytes: 0,
            compressionRatio: 0,
            counts: { daily: 0, weekly: 0, monthly: 0 },
            items: { daily: [], weekly: [], monthly: [] },
        });
        existing.version = 2;
        existing.archiveDir = p.root;
        existing.cognitive = stats;
        writeAtomic(p.indexFile, JSON.stringify(existing, null, 2) + "\n");
        return { index: existing, stats };
    }

    /**
     * Mem0 + Hindsight + Cognee + Graphiti: Retain atomic memory with conflict resolution
     */
    function retain(input = {}, opts = {}) {
        const p = pathsOf();
        ensureDirs(p);
        const now = parseTimestamp(input.timestamp, Date.now());
        const rawText = scrubSecrets(String(input.content || input.text || input.l2 || input.title || "")).trim();
        if (!rawText) throw new Error("retain 需要提供非空的记忆内容 (content)。");

        const bank = VALID_BANKS.has(input.bank) ? input.bank : classifyBank(rawText, input.category || "");
        const scope = VALID_SCOPES.has(input.scope) ? input.scope : (input.project ? "project" : "user");
        const project = input.project ? sanitizeSnippet(input.project, 64) : "";
        const agent = input.agent ? sanitizeSnippet(input.agent, 48) : "";
        const agentId = input.agentId ? sanitizeSnippet(input.agentId, 64) : agent;
        const source = input.source ? sanitizeSnippet(input.source, 32) : "agent";
        const originChannel = VALID_ORIGIN_CHANNELS.has(input.originChannel)
            ? input.originChannel
            : (source === "user" ? "user" : source === "system" ? "shared" : source === "import" ? "import" : "agent");
        const memoryType = typeof input.memoryType === "string" && input.memoryType.trim()
            ? sanitizeSnippet(input.memoryType, 32).toLowerCase()
            : (bank === "opinion" ? "preference" : bank === "experience" ? "lesson" : bank === "observation" || bank === "mental_model" ? "insight" : "fact");
        const category = input.category ? sanitizeSnippet(input.category, 64) : classifyCategory(bank, rawText, project);
        const tier = VALID_TIERS.has(input.tier) ? input.tier : classifyTier(bank, category, scope, memoryType);
        const ttlDays = Number.isFinite(Number(input.ttlDays)) && Number(input.ttlDays) > 0 ? Number(input.ttlDays) : null;
        const forgetAfter = parseTimestamp(input.forgetAfter, ttlDays ? now + Math.round(ttlDays * MS_PER_DAY) : null);
        const factKey = input.factKey ? slugify(input.factKey) : "";
        const tags = Array.isArray(input.tags)
            ? [...new Set(input.tags.map(t => sanitizeSnippet(t, 32)).filter(Boolean))].slice(0, 12)
            : typeof input.tags === "string"
                ? [...new Set(input.tags.split(/[,，]/).map(t => sanitizeSnippet(t, 32)).filter(Boolean))].slice(0, 12)
                : [];
        const confidence = Number.isFinite(Number(input.confidence))
            ? Math.max(0.1, Math.min(1, Number(input.confidence)))
            : (bank === "opinion" ? 0.78 : bank === "observation" ? 0.85 : 0.9);
        const evidence = Array.isArray(input.evidence) ? [...new Set(input.evidence.filter(Boolean))].slice(0, 20) : [];

        const layers = buildLayeredContent({
            title: input.title,
            content: rawText,
            l0: input.l0,
            l1: input.l1,
            l2: input.l2 || rawText,
        });
        const newTokens = tokenize(`${layers.title} ${layers.l1} ${tags.join(" ")}`);

        const itemStore = opts._itemStore || loadItemStore(p);
        const graphStore = opts._graphStore || loadGraphStore(p);

        // Mem0 Conflict Resolution + agentmemory near-duplicate advisory hints (`similarTo`)
        const candidates = itemStore.items.filter(it =>
            it.status === "active" &&
            it.scope === scope &&
            (it.project || "") === project
        );

        let matched = null;
        let matchReason = "";
        let bestSim = 0;
        let bestCand = null;
        const similarCandidates = [];

        if (input.updateId) {
            matched = itemStore.items.find(it => it.id === input.updateId && it.status === "active") || null;
            if (matched) matchReason = "explicit_id";
        }
        if (!matched && factKey) {
            matched = candidates.find(it => it.factKey && it.factKey === factKey) || null;
            if (matched) matchReason = "fact_key";
        }
        for (const cand of candidates) {
            const candTokens = tokenize(`${cand.title} ${cand.l1} ${(cand.tags || []).join(" ")}`);
            const sim = jaccardSimilarity(newTokens, candTokens);
            if (sim >= 0.35 && (!matched || cand.id !== matched.id)) {
                similarCandidates.push({ id: cand.id, uri: `qlex://items/${cand.id}`, title: cand.title, bank: cand.bank, similarity: Number(sim.toFixed(2)) });
            }
            if (!matched && (cand.bank === bank || factKey)) {
                if (sim > bestSim) {
                    bestSim = sim;
                    bestCand = cand;
                }
            }
        }
        if (!matched && bestCand) {
            if (bestSim >= 0.86) {
                matched = bestCand;
                matchReason = "near_duplicate";
            } else if (bestSim >= 0.6) {
                matched = bestCand;
                matchReason = "similar";
            }
        }
        const similarTo = similarCandidates
            .filter(s => !matched || s.id !== matched.id)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 3);

        let operation = "ADD";
        let resultItem = null;
        let supersededId = null;

        const isSystemReflection = bank === "observation" || bank === "mental_model";
        const isExactDuplicate = matched && (
            matched.l2.trim().toLowerCase() === layers.l2.trim().toLowerCase() ||
            (matchReason === "near_duplicate" && !detectSupersedeSignal(rawText) && !input.supersede)
        );

        const isSupersede = matched && !isSystemReflection && (
            Boolean(input.supersede) ||
            (matchReason === "fact_key" && matched.l2.trim().toLowerCase() !== layers.l2.trim().toLowerCase()) ||
            (detectSupersedeSignal(rawText) && matched.l2.trim().toLowerCase() !== layers.l2.trim().toLowerCase())
        );

        if (isExactDuplicate) {
            operation = "NOOP";
            matched.hitCount = (matched.hitCount || 1) + 1;
            matched.reinforcements = (matched.reinforcements || 0) + 1;
            matched.confidence = Number(Math.min(1, (matched.confidence ?? 0.8) + 0.1 * (1 - (matched.confidence ?? 0.8))).toFixed(3));
            matched.lastSeenAt = now;
            const log = normalizeAccessLog(matched.accessLog);
            log.count += 1;
            log.lastAt = now;
            log.recent = [...log.recent, now].slice(-ACCESS_RECENT_CAP);
            matched.accessLog = log;
            if (evidence.length) matched.evidence = [...new Set([...(matched.evidence || []), ...evidence])].slice(0, 20);
            resultItem = matched;
        } else if (isSupersede) {
            operation = "SUPERSEDE";
            const newId = `mem_${randomUUID().slice(0, 10)}`;
            matched.status = "superseded";
            matched.validTo = now;
            matched.supersededBy = newId;
            matched.updatedAt = now;
            supersededId = matched.id;

            resultItem = {
                id: newId,
                uri: `qlex://items/${newId}`,
                bank,
                tier,
                memoryType,
                originChannel,
                scope,
                project,
                agent,
                agentId,
                source,
                category,
                factKey: factKey || matched.factKey || "",
                tags: [...new Set([...(matched.tags || []), ...tags])].slice(0, 12),
                title: layers.title,
                l0: layers.l0,
                l1: layers.l1,
                l2: layers.l2,
                confidence,
                reinforcements: 0,
                accessLog: { count: 1, lastAt: now, recent: [now] },
                forgetAfter,
                status: "active",
                version: (matched.version || 1) + 1,
                hitCount: 1,
                validFrom: parseTimestamp(input.validFrom, now),
                validTo: null,
                recordedAt: now,
                updatedAt: now,
                lastSeenAt: now,
                supersedes: matched.id,
                supersededBy: null,
                evidence: [...new Set([...evidence, matched.id])].slice(0, 20),
                evidenceVersion: input.evidenceVersion || undefined,
                sourceMemoryIds: Array.isArray(input.sourceMemoryIds) ? input.sourceMemoryIds : undefined,
                sourceLessonIds: Array.isArray(input.sourceLessonIds) ? input.sourceLessonIds : undefined,
                revisions: [],
                explicitTriples: input.triples,
            };
            itemStore.items.push(resultItem);
        } else if (matched) {
            operation = "UPDATE";
            matched.revisions ||= [];
            matched.revisions.push({
                version: matched.version || 1,
                title: matched.title,
                l0: matched.l0,
                l1: matched.l1,
                updatedAt: matched.updatedAt,
            });
            if (matched.revisions.length > 10) matched.revisions = matched.revisions.slice(-10);
            matched.title = layers.title;
            matched.l0 = layers.l0;
            matched.l1 = layers.l1;
            matched.l2 = layers.l2.length >= matched.l2.length ? layers.l2 : `${matched.l2}\n\n[补充 ${fmtIsoShort(now)}]\n${layers.l2}`.slice(0, 12000);
            matched.tier = tier;
            matched.memoryType = matched.memoryType || memoryType;
            matched.originChannel = matched.originChannel || originChannel;
            if (forgetAfter !== null) matched.forgetAfter = forgetAfter;
            matched.tags = [...new Set([...(matched.tags || []), ...tags])].slice(0, 12);
            matched.evidence = [...new Set([...(matched.evidence || []), ...evidence])].slice(0, 20);
            if (input.evidenceVersion) matched.evidenceVersion = input.evidenceVersion;
            if (Array.isArray(input.sourceMemoryIds)) matched.sourceMemoryIds = input.sourceMemoryIds;
            if (Array.isArray(input.sourceLessonIds)) matched.sourceLessonIds = input.sourceLessonIds;
            matched.reinforcements = (matched.reinforcements || 0) + 1;
            matched.confidence = Number(Math.min(1, Math.max(matched.confidence || 0.7, confidence) + 0.05 * (1 - Math.max(matched.confidence || 0.7, confidence))).toFixed(3));
            matched.version = (matched.version || 1) + 1;
            matched.updatedAt = now;
            matched.lastSeenAt = now;
            matched.explicitTriples = input.triples;
            resultItem = matched;
        } else {
            operation = "ADD";
            const newId = `mem_${randomUUID().slice(0, 10)}`;
            resultItem = {
                id: newId,
                uri: `qlex://items/${newId}`,
                bank,
                tier,
                memoryType,
                originChannel,
                scope,
                project,
                agent,
                agentId,
                source,
                category,
                factKey,
                tags,
                title: layers.title,
                l0: layers.l0,
                l1: layers.l1,
                l2: layers.l2,
                confidence,
                reinforcements: 0,
                accessLog: { count: 1, lastAt: now, recent: [now] },
                forgetAfter,
                status: "active",
                version: 1,
                hitCount: 1,
                validFrom: parseTimestamp(input.validFrom, now),
                validTo: null,
                recordedAt: now,
                updatedAt: now,
                lastSeenAt: now,
                supersedes: null,
                supersededBy: null,
                evidence,
                evidenceVersion: input.evidenceVersion || undefined,
                sourceMemoryIds: Array.isArray(input.sourceMemoryIds) ? input.sourceMemoryIds : undefined,
                sourceLessonIds: Array.isArray(input.sourceLessonIds) ? input.sourceLessonIds : undefined,
                revisions: [],
                explicitTriples: input.triples,
            };
            itemStore.items.push(resultItem);
        }

        // Update Cognee + Graphiti Knowledge Graph (skip graph edge extraction for synthesized system reflections to avoid self-referential loops)
        let graphDelta = { entitiesAdded: 0, edgesAdded: 0, edgesSuperseded: 0 };
        if (!isSystemReflection) {
            const extracted = extractEntitiesAndTriples(resultItem);
            graphDelta = applyGraphUpdates(graphStore, resultItem, extracted, now);
        }
        delete resultItem.explicitTriples;

        if (!opts._deferPersist) {
            saveItemStore(itemStore, p);
            saveGraphStore(graphStore, p);
            materializeViews(itemStore, graphStore, p);
            syncIndexCognitiveStats(itemStore, graphStore, p);
        }

        return {
            operation,
            item: structuredClone(resultItem),
            supersededId,
            similarTo,
            graphDelta,
        };
    }

    /**
     * Mem0 Soft/Hard Delete
     */
    function forget(id, { reason = "", hard = false } = {}) {
        const p = pathsOf();
        const itemStore = loadItemStore(p);
        const graphStore = loadGraphStore(p);
        const idx = itemStore.items.findIndex(it => it.id === id);
        if (idx === -1) throw new Error(`未找到记忆条目：${id}`);
        const now = Date.now();
        if (hard) {
            itemStore.items.splice(idx, 1);
        } else {
            itemStore.items[idx].status = "deleted";
            itemStore.items[idx].validTo = now;
            itemStore.items[idx].updatedAt = now;
            itemStore.items[idx].deleteReason = sanitizeSnippet(reason, 120);
        }
        // Invalidate edges whose sole evidence was this memory
        for (const edge of graphStore.edges) {
            if (!edge.validTo && Array.isArray(edge.evidence) && edge.evidence.length === 1 && edge.evidence[0] === id) {
                edge.validTo = now;
            }
        }
        saveItemStore(itemStore, p);
        saveGraphStore(graphStore, p);
        const stats = materializeViews(itemStore, graphStore, p);
        syncIndexCognitiveStats(itemStore, graphStore, p);
        return { id, status: hard ? "hard_deleted" : "deleted", stats };
    }

    /**
     * Save or Reinforce Procedural Lesson (agentmemory-inspired diminishing-returns confidence)
     */
    function saveLesson(input = {}) {
        const trigger = sanitizeSnippet(input.trigger || input.problem || "", 240);
        const solution = scrubSecrets(String(input.solution || input.content || "")).trim();
        const combined = trigger && solution && !solution.includes(trigger)
            ? `场景/问题：${trigger}\n解决方案：${solution}`
            : (solution || trigger);
        if (!combined) throw new Error("saveLesson 需要提供 solution 或 content。");
        return retain({
            ...input,
            title: input.title || sanitizeSnippet(trigger || solution, 64),
            content: combined,
            bank: "experience",
            tier: "procedural",
            memoryType: "lesson",
            category: "experiences",
            originChannel: input.originChannel || "agent",
            confidence: input.confidence ?? 0.85,
            sourceMemoryIds: Array.isArray(input.sourceMemoryIds) ? input.sourceMemoryIds : undefined,
        });
    }

    /**
     * Hybrid Recall v3:
     *  - Pre-index targetLayer filter (all | memory | observation | lesson)
     *  - Direct selective ID expansion (`expandIds`)
     *  - 3-Stream Reciprocal Rank Fusion (Okapi BM25 + Bounded 2-Hop Graph BFS + Ebbinghaus Retention)
     *  - Rank-preserving token-budgeted packing (`tokenBudget`, `format`, `excluded_results`)
     *  - Spaced-repetition access strengthening on matched results
     */
    function recall(query = "", opts = {}) {
        const p = pathsOf();
        const itemStore = loadItemStore(p);
        const graphStore = loadGraphStore(p);
        const now = Date.now();
        const level = VALID_LEVELS.has(String(opts.level || "").toUpperCase()) ? String(opts.level).toUpperCase() : "L1";
        const format = VALID_FORMATS.has(String(opts.format || "").toLowerCase()) ? String(opts.format).toLowerCase() : "full";
        const targetLayer = VALID_LAYERS.has(String(opts.targetLayer || opts.layer || "").toLowerCase())
            ? String(opts.targetLayer || opts.layer).toLowerCase()
            : "all";
        const limit = Math.max(1, Math.min(50, Number(opts.limit) || 10));
        const tokenBudget = Number.isFinite(Number(opts.tokenBudget ?? opts.token_budget)) && Number(opts.tokenBudget ?? opts.token_budget) > 0
            ? Math.max(80, Math.floor(Number(opts.tokenBudget ?? opts.token_budget)))
            : 0;
        const asOfTs = parseTimestamp(opts.asOf, null);
        const includeSuperseded = Boolean(opts.includeSuperseded) || Boolean(asOfTs);
        const filterBank = opts.bank && VALID_BANKS.has(opts.bank) ? opts.bank : null;
        const filterTier = opts.tier && VALID_TIERS.has(opts.tier) ? opts.tier : null;
        const filterScope = opts.scope && VALID_SCOPES.has(opts.scope) ? opts.scope : null;
        const filterProject = opts.project ? String(opts.project).trim().toLowerCase() : null;
        const filterCategory = opts.category ? String(opts.category).trim().toLowerCase() : null;
        const filterAgentId = opts.agentId ? String(opts.agentId).trim().toLowerCase() : null;

        // Direct ID expansion mode (agentmemory `expandIds`, no query required!)
        const rawExpand = opts.expandIds;
        const expandList = Array.isArray(rawExpand)
            ? rawExpand.map(x => String(x || "").trim()).filter(Boolean).slice(0, 100)
            : typeof rawExpand === "string" && rawExpand.trim()
                ? rawExpand.split(/[\s,]+/).map(x => x.trim()).filter(Boolean).slice(0, 100)
                : [];
        if (expandList.length) {
            const wantSet = new Set(expandList);
            const matchedExpanded = itemStore.items
                .filter(it => wantSet.has(it.id) && it.status !== "deleted")
                .filter(it => !filterProject || (it.project || "").toLowerCase() === filterProject)
                .filter(it => !filterAgentId || (it.agentId || it.agent || "").toLowerCase() === filterAgentId)
                .slice(0, 20);
            const expandedResults = matchedExpanded.map(item => {
                const ret = computeRetention(item, now);
                return {
                    id: item.id,
                    uri: `qlex://items/${item.id}`,
                    score: 1,
                    bank: item.bank,
                    tier: item.tier || classifyTier(item.bank, item.category, item.scope, item.memoryType),
                    layer: resolveMemoryLayer(item),
                    memoryType: item.memoryType || "fact",
                    originChannel: item.originChannel || "agent",
                    scope: item.scope,
                    project: item.project || "",
                    category: item.category,
                    status: item.status,
                    confidence: item.confidence,
                    retentionScore: ret.retentionScore,
                    temperature: ret.temperature,
                    validFrom: item.validFrom,
                    validTo: item.validTo,
                    supersededBy: item.supersededBy,
                    title: item.title,
                    l0: item.l0,
                    l1: item.l1,
                    l2: item.l2,
                    tags: item.tags || [],
                    version: item.version || 1,
                    evidence: item.evidence || [],
                    revisions: item.revisions || [],
                    supersedes: item.supersedes,
                };
            });
            return {
                query: "",
                level: "L2",
                format,
                targetLayer,
                asOf: null,
                totalMatched: expandedResults.length,
                matched_count: expandedResults.length,
                tokens_used: expandedResults.reduce((s, r) => s + estimateTokens(r), 0),
                excluded_by_budget: 0,
                excluded_results: [],
                truncated: expandList.length > 20,
                results: expandedResults,
                graphContext: [],
            };
        }

        const qClean = String(query || "").trim();
        const qLower = qClean.toLowerCase();
        const rawQTokens = tokenize(qClean);
        const qTokens = expandQueryTokens(rawQTokens);
        const qTokenSet = new Set(qTokens);

        // Stream 2: Bounded 2-Hop Graph BFS (max 25 seed nodes, stronger edges first, max 500 visited)
        const seedEntities = [];
        for (const ent of graphStore.entities) {
            const nameLower = ent.name.toLowerCase();
            if (!qLower) continue;
            const exact = qLower === nameLower || qTokenSet.has(nameLower);
            const partial = !exact && (qLower.includes(nameLower) || nameLower.includes(qLower));
            if (exact || partial) {
                seedEntities.push({ ent, priority: exact ? 2 : 1 });
            }
        }
        seedEntities.sort((a, b) => b.priority - a.priority || (b.ent.mentions || 0) - (a.ent.mentions || 0) || a.ent.name.localeCompare(b.ent.name));
        const seedIds = new Set(seedEntities.slice(0, 25).map(s => s.ent.id));

        const adjacency = new Map();
        const validEdges = [];
        for (const edge of graphStore.edges) {
            const edgeValidAtTime = asOfTs
                ? (edge.validFrom <= asOfTs && (!edge.validTo || edge.validTo > asOfTs))
                : !edge.validTo;
            if (!edgeValidAtTime && !opts.includeSuperseded) continue;
            validEdges.push(edge);
            if (!adjacency.has(edge.subjectId)) adjacency.set(edge.subjectId, []);
            if (!adjacency.has(edge.objectId)) adjacency.set(edge.objectId, []);
            adjacency.get(edge.subjectId).push({ neighbor: edge.objectId, edge });
            adjacency.get(edge.objectId).push({ neighbor: edge.subjectId, edge });
        }
        // Sort adjacency lists by edge confidence descending so stronger edges traverse first
        for (const list of adjacency.values()) {
            list.sort((a, b) => (b.edge.confidence || 0.8) - (a.edge.confidence || 0.8) || (b.edge.lastConfirmedAt || 0) - (a.edge.lastConfirmedAt || 0));
        }

        const graphScoreMap = new Map();
        const relatedEdges = [];
        const seenEdges = new Set();
        const visitedNodes = new Set(seedIds);
        const hop1Nodes = new Set();

        // Hop 1
        for (const nid of seedIds) {
            for (const { neighbor, edge } of adjacency.get(nid) || []) {
                if (!seenEdges.has(edge.id)) {
                    seenEdges.add(edge.id);
                    relatedEdges.push(edge);
                }
                for (const evId of edge.evidence || []) {
                    graphScoreMap.set(evId, (graphScoreMap.get(evId) || 0) + (edge.confidence || 0.85));
                }
                if (!visitedNodes.has(neighbor) && visitedNodes.size < 500) {
                    visitedNodes.add(neighbor);
                    hop1Nodes.add(neighbor);
                }
            }
        }
        // Hop 2 (bounded)
        let examinedHop2 = 0;
        for (const nid of hop1Nodes) {
            if (examinedHop2 >= 600) break;
            for (const { edge } of adjacency.get(nid) || []) {
                examinedHop2++;
                if (examinedHop2 > 600) break;
                for (const evId of edge.evidence || []) {
                    graphScoreMap.set(evId, (graphScoreMap.get(evId) || 0) + 0.45 * (edge.confidence || 0.8));
                }
            }
        }

        // Pre-index candidate filter (targetLayer runs BEFORE BM25 & graph ranking!)
        const candidates = itemStore.items.filter(it => {
            if (it.status === "deleted") return false;
            if (!asOfTs && it.forgetAfter && it.forgetAfter <= now) return false;
            if (asOfTs) {
                const vf = it.validFrom || it.recordedAt || 0;
                if (vf > asOfTs) return false;
                if (it.validTo && it.validTo <= asOfTs) return false;
            } else if (!includeSuperseded && it.status !== "active") {
                return false;
            }
            if (targetLayer !== "all" && resolveMemoryLayer(it) !== targetLayer) return false;
            if (filterBank && it.bank !== filterBank) return false;
            if (filterTier && (it.tier || classifyTier(it.bank, it.category, it.scope, it.memoryType)) !== filterTier) return false;
            if (filterScope && it.scope !== filterScope) return false;
            if (filterProject && (it.project || "").toLowerCase() !== filterProject) return false;
            if (filterCategory && (it.category || "").toLowerCase() !== filterCategory) return false;
            if (filterAgentId && (it.agentId || it.agent || "").toLowerCase() !== filterAgentId) return false;
            return true;
        });

        // Stream 1: Field-Weighted Okapi BM25 (k1 = 1.5, b = 0.75)
        const df = new Map();
        const docTfMap = new Map();
        const docLenMap = new Map();
        let totalDocLen = 0;

        for (const it of candidates) {
            const tf = new Map();
            const addField = (text, weight) => {
                for (const t of tokenize(text)) {
                    tf.set(t, (tf.get(t) || 0) + weight);
                }
            };
            addField(it.title, 3.0);
            addField(`${(it.tags || []).join(" ")} ${it.project || ""}`, 2.0);
            addField(`${it.l0} ${it.l1}`, 1.5);
            addField(it.l2, 1.0);

            let dl = 0;
            for (const [t, w] of tf.entries()) {
                dl += w;
                df.set(t, (df.get(t) || 0) + 1);
            }
            docTfMap.set(it.id, tf);
            docLenMap.set(it.id, dl);
            totalDocLen += dl;
        }
        const N = Math.max(1, candidates.length);
        const avgDl = Math.max(1, totalDocLen / N);
        const K1 = 1.5;
        const B = 0.75;

        const bm25List = [];
        const graphList = [];
        const retList = [];
        const retMetaMap = new Map();
        const exactBonusMap = new Map();

        for (const it of candidates) {
            const ret = computeRetention(it, now);
            retMetaMap.set(it.id, ret);
            retList.push({ id: it.id, score: ret.retentionScore * (it.bank === "mental_model" ? 1.15 : it.bank === "opinion" ? 1.08 : 1.0) });

            const gScore = graphScoreMap.get(it.id) || 0;
            if (gScore > 0) graphList.push({ id: it.id, score: gScore });

            if (!qClean) {
                bm25List.push({ id: it.id, score: 1.0 });
                continue;
            }

            const tf = docTfMap.get(it.id);
            const dl = docLenMap.get(it.id) || 1;
            let bm25 = 0;
            for (const qt of qTokenSet) {
                const f = tf.get(qt) || 0;
                if (f <= 0) continue;
                const docFreq = df.get(qt) || 0;
                const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
                const rawBoost = rawQTokens.includes(qt) ? 1.0 : 0.65;
                bm25 += rawBoost * idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (dl / avgDl))));
            }
            const hay = `${it.title} ${it.l0} ${it.l1} ${it.l2}`.toLowerCase();
            let exactBonus = 0;
            if (hay.includes(qLower)) exactBonus += 0.045;
            if (it.title.toLowerCase().includes(qLower)) exactBonus += 0.035;
            if (it.project && qLower.includes(it.project.toLowerCase())) exactBonus += 0.015;
            if (exactBonus > 0) exactBonusMap.set(it.id, exactBonus);

            if (bm25 > 0 || exactBonus > 0) {
                bm25List.push({ id: it.id, score: bm25 + exactBonus * 40 });
            }
        }

        // Reciprocal Rank Fusion (RRF, k = 60)
        const RRF_K = 60;
        bm25List.sort((a, b) => b.score - a.score);
        graphList.sort((a, b) => b.score - a.score);
        retList.sort((a, b) => b.score - a.score);

        const bm25Rank = new Map(bm25List.map((x, i) => [x.id, i + 1]));
        const graphRank = new Map(graphList.map((x, i) => [x.id, i + 1]));
        const retRank = new Map(retList.map((x, i) => [x.id, i + 1]));

        const scored = [];
        for (const it of candidates) {
            const rb = bm25Rank.get(it.id);
            const rg = graphRank.get(it.id);
            if (qClean && !rb && !rg) continue;
            const rr = retRank.get(it.id) || candidates.length;
            const rrfScore =
                (rb ? 1.0 / (RRF_K + rb) : 0) +
                (rg ? 0.65 / (RRF_K + rg) : 0) +
                (0.35 / (RRF_K + rr)) +
                (exactBonusMap.get(it.id) || 0);
            scored.push({
                item: it,
                score: Number((rrfScore * 100).toFixed(3)),
                streams: { bm25Rank: rb || null, graphRank: rg || null, retentionRank: rr },
            });
        }

        scored.sort((a, b) => b.score - a.score || (b.item.updatedAt || 0) - (a.item.updatedAt || 0));

        // Build formatted entries & apply rank-preserving tokenBudget packing
        const rankedTop = scored.slice(0, limit);
        const packedResults = [];
        const excludedResults = [];
        let tokensUsed = 0;
        let truncated = false;
        let minimumBudget = null;

        const formatResult = ({ item, score, streams }, clipLen = 0) => {
            const ret = retMetaMap.get(item.id) || computeRetention(item, now);
            const base = {
                id: item.id,
                uri: `qlex://items/${item.id}`,
                score,
                bank: item.bank,
                tier: item.tier || classifyTier(item.bank, item.category, item.scope, item.memoryType),
                layer: resolveMemoryLayer(item),
                memoryType: item.memoryType || "fact",
                originChannel: item.originChannel || "agent",
                scope: item.scope,
                project: item.project || "",
                category: item.category,
                status: item.status,
                confidence: item.confidence,
                retentionScore: ret.retentionScore,
                temperature: ret.temperature,
                accessCount: ret.accessCount,
                validFrom: item.validFrom,
                validTo: item.validTo,
                supersededBy: item.supersededBy,
                title: item.title,
                l0: clipLen ? `${item.l0.slice(0, clipLen)}…` : item.l0,
                streams,
                ...(clipLen ? { content_truncated: true } : {}),
            };
            if (format === "compact" || level === "L0") return base;
            if (level === "L1") {
                const l1Text = clipLen ? `${(item.l1 || item.l0).slice(0, clipLen)}…` : item.l1;
                return { ...base, l1: l1Text, tags: item.tags || [], version: item.version || 1 };
            }
            const l2Text = clipLen ? `${(item.l2 || item.l1 || item.l0).slice(0, clipLen)}…` : item.l2;
            return {
                ...base,
                l1: clipLen ? `${(item.l1 || item.l0).slice(0, Math.min(clipLen, 180))}…` : item.l1,
                l2: l2Text,
                tags: item.tags || [],
                version: item.version || 1,
                evidence: item.evidence || [],
                revisions: item.revisions || [],
                supersedes: item.supersedes,
            };
        };

        for (let i = 0; i < rankedTop.length; i++) {
            const entry = formatResult(rankedTop[i]);
            const cost = estimateTokens(entry);
            if (!tokenBudget || tokensUsed + cost <= tokenBudget) {
                packedResults.push(entry);
                tokensUsed += cost;
                continue;
            }
            // Try graceful clipped preview for the remaining budget (rank-preserving!)
            const remaining = tokenBudget - tokensUsed;
            const clipped = formatResult(rankedTop[i], 90);
            const clippedCost = estimateTokens(clipped);
            if (clippedCost <= remaining) {
                packedResults.push(clipped);
                tokensUsed += clippedCost;
                truncated = true;
                continue;
            }
            if (i === 0 && minimumBudget === null) {
                minimumBudget = clippedCost;
            }
            truncated = true;
            if (excludedResults.length < 10) {
                excludedResults.push({
                    id: rankedTop[i].item.id,
                    uri: `qlex://items/${rankedTop[i].item.id}`,
                    title: rankedTop[i].item.title,
                    score: rankedTop[i].score,
                });
            }
        }

        // Spaced-repetition access strengthening on top matched hits (when real query runs)
        if (qClean && packedResults.length && opts.trackAccess !== false) {
            const hitIds = new Set(packedResults.slice(0, 5).map(r => r.id));
            let touched = false;
            for (const it of itemStore.items) {
                if (!hitIds.has(it.id)) continue;
                const log = normalizeAccessLog(it.accessLog);
                // Throttle access recording to at most once per minute per item
                if (now - log.lastAt >= 60_000 || log.count === 0) {
                    log.count += 1;
                    log.lastAt = now;
                    log.recent = [...log.recent, now].slice(-ACCESS_RECENT_CAP);
                    it.accessLog = log;
                    it.lastSeenAt = now;
                    touched = true;
                }
            }
            if (touched) {
                try { saveItemStore(itemStore, p); } catch { /* non-fatal */ }
            }
        }

        const entMap = new Map(graphStore.entities.map(e => [e.id, e]));
        const graphContext = relatedEdges.slice(0, 10).map(e => ({
            subject: entMap.get(e.subjectId)?.name || e.subjectId,
            predicate: e.predicate,
            object: entMap.get(e.objectId)?.name || e.objectId,
            validFrom: e.validFrom,
            validTo: e.validTo,
            active: !e.validTo,
        }));

        const narrative = format === "narrative"
            ? packedResults.map((r, idx) => `${idx + 1}. [${r.bank}/${r.temperature}] ${r.title}: ${r.l1 || r.l0}`).join("\n")
            : undefined;

        return {
            query: qClean,
            level,
            format,
            targetLayer,
            asOf: asOfTs ? fmtIsoShort(asOfTs) : null,
            totalMatched: scored.length,
            matched_count: rankedTop.length,
            tokens_used: tokensUsed,
            token_budget: tokenBudget || null,
            excluded_by_budget: Math.max(0, rankedTop.length - packedResults.length),
            excluded_results: excludedResults,
            truncated,
            ...(minimumBudget !== null ? { minimum_budget: minimumBudget } : {}),
            ...(narrative !== undefined ? { text: narrative } : {}),
            results: packedResults,
            graphContext,
        };
    }

    /**
     * Hindsight Reflect: Synthesize evidence-grounded observations & mental models
     */
    function reflect(opts = {}) {
        const p = pathsOf();
        ensureDirs(p);
        const itemStore = opts._itemStore || loadItemStore(p);
        const graphStore = opts._graphStore || loadGraphStore(p);
        const targetProject = opts.project ? String(opts.project).trim() : "";

        const active = itemStore.items.filter(i =>
            i.status === "active" &&
            i.bank !== "observation" &&
            i.bank !== "mental_model" &&
            (!targetProject || (i.project || "").toLowerCase() === targetProject.toLowerCase())
        );

        const created = [];
        const entMap = new Map(graphStore.entities.map(e => [e.id, e]));

        // 1. Synthesize User Preference & Working Style Mental Model (with evidence provenance validation)
        const activeIdSet = new Set(itemStore.items.filter(i => i.status === "active").map(i => i.id));
        const validateEv = (ids) => [...new Set((ids || []).filter(id => activeIdSet.has(id)))].slice(0, 20);

        const opinions = active.filter(i => i.bank === "opinion");
        if (opinions.length > 0 && !targetProject) {
            const evIds = validateEv(opinions.map(o => o.id));
            const l0 = `用户偏好心智模型：提炼自 ${evIds.length} 条偏好记忆（${opinions.slice(0, 3).map(o => o.title).join("；")}）`;
            const l2 = [
                `基于 ${evIds.length} 条活跃偏好记录自动合成（evidenceVersion: 1）：`,
                ...opinions.slice(0, 12).map(o => `- ${o.l0} (\`${o.id}\`)`),
            ].join("\n");
            created.push(retain({
                title: "用户偏好与交互心智模型",
                content: l2,
                l0,
                l1: l2.slice(0, 600),
                l2,
                bank: "mental_model",
                tier: "procedural",
                memoryType: "insight",
                scope: "user",
                category: "observations",
                factKey: "mental_model:user_preferences",
                confidence: 0.9,
                evidence: evIds,
                evidenceVersion: 1,
                sourceMemoryIds: evIds,
                source: "system",
            }, { _itemStore: itemStore, _graphStore: graphStore, _deferPersist: true }));
        }

        // 2. Synthesize Per-Project Mental Models
        const byProject = new Map();
        for (const it of active) {
            if (!it.project) continue;
            if (!byProject.has(it.project)) byProject.set(it.project, []);
            byProject.get(it.project).push(it);
        }
        for (const [proj, list] of byProject.entries()) {
            if (list.length < 2 && !targetProject) continue;
            const decisions = list.filter(i => i.category === "decisions" || i.bank === "world").slice(0, 6);
            const exps = list.filter(i => i.bank === "experience").slice(0, 6);
            const projEntId = `project:${slugify(proj)}`;
            const projEdges = graphStore.edges.filter(e => !e.validTo && e.subjectId === projEntId).slice(0, 8);
            const techStack = projEdges.map(e => `${e.predicate}:${entMap.get(e.objectId)?.name || e.objectId}`);

            const l0 = `${proj} 项目心智模型：${list.length} 条记忆，关联 ${techStack.slice(0, 4).join("、") || "核心上下文"}`;
            const lines = [`项目 **${proj}** 综合心智模型（证据 ${list.length} 条）：`];
            if (techStack.length) lines.push(`- **技术与工具关联**：${techStack.join(" · ")}`);
            if (decisions.length) {
                lines.push("- **关键事实与决策**：");
                for (const d of decisions) lines.push(`  - ${d.l0} (\`${d.id}\`)`);
            }
            if (exps.length) {
                lines.push("- **经验教训与修复**：");
                for (const ex of exps) lines.push(`  - ${ex.l0} (\`${ex.id}\`)`);
            }
            const l2 = lines.join("\n");
            created.push(retain({
                title: `${proj} 项目心智模型`,
                content: l2,
                l0,
                l1: l2.slice(0, 700),
                l2,
                bank: "mental_model",
                scope: "project",
                project: proj,
                category: "observations",
                factKey: `mental_model:project:${slugify(proj)}`,
                confidence: 0.88,
                evidence: list.slice(0, 15).map(i => i.id),
                source: "system",
            }, { _itemStore: itemStore, _graphStore: graphStore, _deferPersist: true }));
        }

        // 3. Synthesize Fact-Evolution Observation (Graphiti temporal changes)
        const supersededItems = itemStore.items.filter(i => i.status === "superseded" && i.bank !== "observation" && i.bank !== "mental_model");
        const evolvedEdges = graphStore.edges.filter(e => Boolean(e.validTo));
        if (supersededItems.length > 0 || evolvedEdges.length > 0) {
            const l0 = `时序演进洞察：检测到 ${supersededItems.length} 次记忆更新替代与 ${evolvedEdges.length} 条知识图谱历史边变更`;
            const lines = [
                `系统自动追踪到 ${supersededItems.length} 条被替代记忆与 ${evolvedEdges.length} 条演进关系：`,
                ...supersededItems.slice(-8).map(s => `- 旧记忆「${s.title}」于 ${fmtIsoShort(s.validTo)} 被 \`${s.supersededBy}\` 替代`),
                ...evolvedEdges.slice(-8).map(e => {
                    const sName = entMap.get(e.subjectId)?.name || e.subjectId;
                    const oName = entMap.get(e.objectId)?.name || e.objectId;
                    return `- 旧关系 ${sName} -${e.predicate}-> ${oName} 于 ${fmtIsoShort(e.validTo)} 失效`;
                }),
            ];
            const l2 = lines.join("\n");
            created.push(retain({
                title: "知识随时间演进观察 (Temporal Evolution)",
                content: l2,
                l0,
                l1: l2.slice(0, 700),
                l2,
                bank: "observation",
                scope: targetProject ? "project" : "user",
                project: targetProject,
                category: "observations",
                factKey: `observation:temporal_evolution:${slugify(targetProject || "global")}`,
                confidence: 0.92,
                evidence: supersededItems.slice(-10).map(s => s.id),
                source: "system",
            }, { _itemStore: itemStore, _graphStore: graphStore, _deferPersist: true }));
        }

        // 4. Synthesize Recurring Experience / Focus Observation
        const topEnts = [...graphStore.entities].sort((a, b) => (b.mentions || 0) - (a.mentions || 0)).slice(0, 8);
        if (active.length >= 2 && topEnts.length > 0) {
            const l0 = `高频关注领域洞察：近期核心实体为 ${topEnts.slice(0, 5).map(e => e.name).join("、")}（共 ${active.length} 条基础记忆）`;
            const l2 = [
                `综合 ${active.length} 条活跃记忆与知识图谱中心度分析：`,
                `- **高频实体**：${topEnts.map(e => `${e.name}(${e.type}, ${e.mentions}次)`).join(" · ")}`,
                `- **经验类条目**：${active.filter(i => i.bank === "experience").length} 条 · **事实类条目**：${active.filter(i => i.bank === "world").length} 条`,
            ].join("\n");
            created.push(retain({
                title: "高频核心主题与技术栈洞察",
                content: l2,
                l0,
                l1: l2,
                l2,
                bank: "observation",
                scope: targetProject ? "project" : "user",
                project: targetProject,
                category: "observations",
                factKey: `observation:focus_areas:${slugify(targetProject || "global")}`,
                confidence: 0.86,
                evidence: active.slice(0, 12).map(i => i.id),
                source: "system",
            }, { _itemStore: itemStore, _graphStore: graphStore, _deferPersist: true }));
        }

        if (!opts._deferPersist) {
            saveItemStore(itemStore, p);
            saveGraphStore(graphStore, p);
            const stats = materializeViews(itemStore, graphStore, p);
            syncIndexCognitiveStats(itemStore, graphStore, p);
            return { generated: created.length, results: created, stats };
        }
        return { generated: created.length, results: created };
    }

    /**
     * Cognee + Graphiti Bi-Temporal Knowledge Graph Query
     */
    function graphQuery({ entity = "", includeHistory = true, asOf = null, limit = 40 } = {}) {
        const p = pathsOf();
        const graphStore = loadGraphStore(p);
        const asOfTs = parseTimestamp(asOf, null);
        const entMap = new Map(graphStore.entities.map(e => [e.id, e]));
        const q = String(entity || "").trim().toLowerCase();

        const matchedEntities = q
            ? graphStore.entities.filter(e => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q))
            : [...graphStore.entities].sort((a, b) => (b.mentions || 0) - (a.mentions || 0)).slice(0, limit);

        const idSet = new Set(matchedEntities.map(e => e.id));
        const edges = graphStore.edges.filter(e => {
            if (q && !idSet.has(e.subjectId) && !idSet.has(e.objectId)) return false;
            if (asOfTs) {
                return e.validFrom <= asOfTs && (!e.validTo || e.validTo > asOfTs);
            }
            if (!includeHistory && e.validTo) return false;
            return true;
        }).slice(-limit).reverse().map(e => ({
            id: e.id,
            subject: entMap.get(e.subjectId)?.name || e.subjectId,
            subjectType: entMap.get(e.subjectId)?.type || "concept",
            predicate: e.predicate,
            object: entMap.get(e.objectId)?.name || e.objectId,
            objectType: entMap.get(e.objectId)?.type || "concept",
            active: !e.validTo,
            validFrom: e.validFrom,
            validTo: e.validTo,
            recordedAt: e.recordedAt,
            supersededBy: e.supersededBy,
            confidence: e.confidence,
            evidence: e.evidence || [],
        }));

        return {
            entity: entity || null,
            asOf: asOfTs ? fmtIsoShort(asOfTs) : null,
            includeHistory,
            entityCount: matchedEntities.length,
            edgeCount: edges.length,
            entities: matchedEntities.slice(0, limit),
            edges,
        };
    }

    /**
     * OpenViking Virtual Context Filesystem (`qlex://`) Browser with L0 / L1 / L2 Progressive Loading
     */
    function browse(uri = "qlex://", levelInput = "L1") {
        const p = pathsOf();
        const level = VALID_LEVELS.has(String(levelInput || "").toUpperCase()) ? String(levelInput).toUpperCase() : "L1";
        const normalized = String(uri || "qlex://").trim().replace(/^qlex:\/\//i, "").replace(/^\/+|\/+$/g, "");
        const parts = normalized ? normalized.split("/") : [];
        const itemStore = loadItemStore(p);
        const graphStore = loadGraphStore(p);
        const index = readJsonSafe(p.indexFile, { counts: { daily: 0, weekly: 0, monthly: 0 }, items: { daily: [], weekly: [], monthly: [] } });
        const stats = computeCognitiveStats(itemStore, graphStore);

        if (!parts.length) {
            const abstract = fs.existsSync(path.join(p.categoriesDir, "_abstract.md"))
                ? fs.readFileSync(path.join(p.categoriesDir, "_abstract.md"), "utf8").trim()
                : `QLEX Memory: ${stats.activeItems} 活跃记忆 · ${stats.entities} 实体 · ${stats.activeEdges} 关系`;
            const overview = fs.existsSync(path.join(p.categoriesDir, "_overview.md"))
                ? fs.readFileSync(path.join(p.categoriesDir, "_overview.md"), "utf8").trim()
                : abstract;
            return {
                uri: "qlex://",
                level,
                kind: "root",
                children: [
                    "qlex://categories",
                    "qlex://items",
                    "qlex://graph",
                    "qlex://reflections",
                    "qlex://daily",
                    "qlex://weekly",
                    "qlex://monthly",
                ],
                stats,
                content: level === "L0" ? abstract : overview,
            };
        }

        const head = parts[0];
        if (head === "categories") {
            if (parts.length === 1) {
                const cats = Object.entries(stats.categories).map(([name, count]) => ({
                    uri: `qlex://categories/${name}`,
                    name,
                    count,
                }));
                const content = level === "L0"
                    ? cats.map(c => `- \`${c.uri}\` (${c.count})`).join("\n")
                    : (fs.existsSync(path.join(p.categoriesDir, "_overview.md"))
                        ? fs.readFileSync(path.join(p.categoriesDir, "_overview.md"), "utf8")
                        : cats.map(c => `- \`${c.uri}\` (${c.count})`).join("\n"));
                return { uri: "qlex://categories", level, kind: "directory", children: cats, content };
            }
            const catKey = parts.slice(1).join("/");
            const items = itemStore.items.filter(i => i.status === "active" && i.category === catKey);
            const content = level === "L0"
                ? items.map(i => `- \`${i.uri}\` ${i.l0}`).join("\n")
                : level === "L1"
                    ? items.map(i => `### ${i.title} (\`${i.uri}\`)\n${i.l1}`).join("\n\n")
                    : items.map(i => `### ${i.title} (\`${i.uri}\`)\n${i.l2}`).join("\n\n");
            return { uri: `qlex://categories/${catKey}`, level, kind: "category", count: items.length, content: content || "(空分类)" };
        }

        if (head === "items") {
            if (parts.length === 1) {
                const active = itemStore.items.filter(i => i.status === "active").slice(-50).reverse();
                const content = active.map(i =>
                    level === "L0" ? `- \`${i.uri}\` [${i.bank}] ${i.l0}` : `- \`${i.uri}\` [${i.bank}/${i.scope}] **${i.title}** — ${i.l1}`
                ).join("\n");
                return { uri: "qlex://items", level, kind: "directory", count: active.length, content: content || "(暂无记忆项)" };
            }
            const id = parts[1];
            const found = itemStore.items.find(i => i.id === id);
            if (!found) throw new Error(`未找到记忆项：qlex://items/${id}`);
            return {
                uri: found.uri,
                level,
                kind: "item",
                item: level === "L0" ? { id: found.id, title: found.title, bank: found.bank, l0: found.l0 }
                    : level === "L1" ? { id: found.id, title: found.title, bank: found.bank, scope: found.scope, project: found.project, l0: found.l0, l1: found.l1, tags: found.tags }
                    : found,
                content: level === "L0" ? found.l0 : level === "L1" ? found.l1 : found.l2,
            };
        }

        if (head === "graph" || head === "entities") {
            const entityName = head === "entities" ? parts.slice(1).join("/") : "";
            const g = graphQuery({ entity: entityName, includeHistory: level === "L2" });
            const lines = g.edges.map(e =>
                `${e.active ? "●" : "○"} ${e.subject} —[${e.predicate}]→ ${e.object}${level === "L2" ? ` (valid: ${fmtIsoShort(e.validFrom)} → ${e.validTo ? fmtIsoShort(e.validTo) : "now"})` : ""}`
            );
            return {
                uri: entityName ? `qlex://entities/${entityName}` : "qlex://graph",
                level,
                kind: "graph",
                graph: g,
                content: lines.join("\n") || "(暂无图谱边)",
            };
        }

        if (head === "reflections") {
            const content = fs.existsSync(p.reflectionsMd) ? fs.readFileSync(p.reflectionsMd, "utf8") : "(尚未生成反思)";
            return {
                uri: "qlex://reflections",
                level,
                kind: "reflections",
                content: level === "L0" ? content.split("\n").slice(0, 12).join("\n") : content,
            };
        }

        if (head === "daily" || head === "weekly" || head === "monthly") {
            const list = index.items?.[head] || [];
            if (parts.length === 1) {
                const content = list.slice(0, 20).map(x => `- \`qlex://${head}/${x.key}\` · ${x.sub}`).join("\n");
                return { uri: `qlex://${head}`, level, kind: "timeline", count: list.length, items: list.slice(0, 20), content: content || "(暂无归档)" };
            }
            const key = parts[1];
            const found = list.find(x => x.key === key);
            if (!found || !fs.existsSync(found.mdPath)) throw new Error(`未找到周期归档：qlex://${head}/${key}`);
            const rawMd = fs.readFileSync(found.mdPath, "utf8");
            return {
                uri: `qlex://${head}/${key}`,
                level,
                kind: head,
                meta: found,
                content: level === "L0" ? rawMd.split("\n").slice(0, 10).join("\n") : level === "L1" ? rawMd.slice(0, 1400) : rawMd,
            };
        }

        throw new Error(`不支持的 OpenViking URI：${uri}`);
    }

    /**
     * Full Incremental Compression + Ingestion + Cognitive Extraction + Reflection + Daily/Weekly/Monthly Rollups
     */
    function compressSync(opts = {}) {
        const p = pathsOf();
        ensureDirs(p);

        const cache = readJsonSafe(p.cacheFile, { version: 2, files: {}, dailyRecords: {}, ingestedHashes: {} });
        cache.files ||= {};
        cache.dailyRecords ||= {};
        cache.ingestedHashes ||= {};

        const { byDate: topicsByDate, hits, misses, resources } = extractHistoryTopicsByDate(home, cache);
        const fallbackDailyTokens = new Map();
        // Merge unified multi-agent topics from native collectors (desktop callback or CLI fallback reading desktop collector-cache.json)
        if (typeof getTopicsByDate === "function") {
            const extraTopics = getTopicsByDate();
            if (extraTopics instanceof Map) {
                for (const [date, entries] of extraTopics.entries()) {
                    let list = topicsByDate.get(date);
                    if (!list) { list = []; topicsByDate.set(date, list); }
                    for (const e of entries) {
                        if (list.length >= 30) break;
                        if (!list.some(x => x.text === e.text)) list.push(e);
                    }
                }
            }
        } else {
            // CLI fallback: read QLEX desktop's collector-cache.json (including nativeSummary for Hermes/WorkBuddy/T3 Code!)
            const cacheCandidates = [
                path.join(home, "Library", "Application Support", "QLEX", "collector-cache.json"),
                path.join(home, "AppData", "Roaming", "QLEX", "collector-cache.json"),
                path.join(home, ".config", "QLEX", "collector-cache.json"),
            ];
            for (const cFile of cacheCandidates) {
                const colCache = readJsonSafe(cFile, null);
                if (!colCache || typeof colCache !== "object") continue;
                let foundAny = false;
                if (colCache.nativeSummary && typeof colCache.nativeSummary === "object") {
                    const ns = colCache.nativeSummary;
                    if (ns.dailyTokens && typeof ns.dailyTokens === "object") {
                        for (const [date, tok] of Object.entries(ns.dailyTokens)) {
                            if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number(tok) > 0) {
                                fallbackDailyTokens.set(date, Math.max(fallbackDailyTokens.get(date) || 0, Number(tok)));
                                foundAny = true;
                            }
                        }
                    }
                    if (ns.topicsByDate && typeof ns.topicsByDate === "object") {
                        for (const [date, entries] of Object.entries(ns.topicsByDate)) {
                            if (!Array.isArray(entries)) continue;
                            let list = topicsByDate.get(date);
                            if (!list) { list = []; topicsByDate.set(date, list); }
                            for (const t of entries) {
                                const text = sanitizeSnippet(t?.text || "", 220);
                                if (text.length < 4 || list.length >= 30) continue;
                                if (!list.some(x => x.text === text)) {
                                    list.push({ date, ts: t.ts || Date.now(), source: t.source || "agent", project: t.project || "", text });
                                    foundAny = true;
                                }
                            }
                        }
                    }
                }
                if (colCache.files && typeof colCache.files === "object") {
                    for (const rec of Object.values(colCache.files)) {
                        const val = rec?.value;
                        if (!val) continue;
                        if (val.dailyBuckets && typeof val.dailyBuckets === "object" && !colCache.nativeSummary) {
                            for (const [date, b] of Object.entries(val.dailyBuckets)) {
                                if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number(b?.tokens) > 0) {
                                    fallbackDailyTokens.set(date, (fallbackDailyTokens.get(date) || 0) + Number(b.tokens));
                                }
                            }
                        }
                        if (!Array.isArray(val.topics)) continue;
                        const proj = val.workspace ? path.basename(val.workspace) : "";
                        for (const t of val.topics) {
                            const date = t?.date || (t?.ts ? localDateKey(t.ts) : "");
                            const text = sanitizeSnippet(t?.text || "", 220);
                            if (!date || text.length < 4) continue;
                            let list = topicsByDate.get(date);
                            if (!list) { list = []; topicsByDate.set(date, list); }
                            if (list.length >= 30) continue;
                            if (!list.some(x => x.text === text)) {
                                list.push({ date, ts: t.ts || val.lastActive || Date.now(), source: val.source || "agent", project: proj, text });
                                foundAny = true;
                            }
                        }
                    }
                }
                if (foundAny || colCache.files) break;
            }
        }
        const usageSnap = typeof getUsageSnapshot === "function" ? (getUsageSnapshot() || {}) : {};
        const todayKey = localDateKey();

        const itemStore = loadItemStore(p);
        const graphStore = loadGraphStore(p);
        const resStore = loadResourceStore(p);

        // Layer 1 (memU Resources): update resource manifest
        for (const r of resources) {
            const idx = resStore.resources.findIndex(x => x.id === r.id);
            if (idx >= 0) resStore.resources[idx] = r;
            else resStore.resources.push(r);
        }

        // Ingest new meaningful topics from AI histories into Mem0 + Cognee/Graphiti (incremental dedup via sha256)
        const recentDates = [...topicsByDate.keys()].sort().slice(-14);
        let ingestedItems = 0;
        for (const date of recentDates) {
            const list = topicsByDate.get(date) || [];
            for (const entry of list.slice(0, 8)) {
                // Only promote substantive memories (>= 12 chars) into atomic cognitive store
                if (!entry.text || entry.text.length < 12) continue;
                const hash = createHash("sha256").update(`${entry.source}|${entry.project}|${entry.text}`).digest("hex").slice(0, 16);
                if (cache.ingestedHashes[hash]) continue;
                cache.ingestedHashes[hash] = date;
                retain({
                    title: sanitizeSnippet(entry.text, 64),
                    content: entry.text,
                    source: entry.source,
                    project: entry.project,
                    scope: entry.project ? "project" : "user",
                    timestamp: entry.ts || Date.now(),
                    tags: [entry.source, date].filter(Boolean),
                }, { _itemStore: itemStore, _graphStore: graphStore, _deferPersist: true });
                ingestedItems++;
            }
        }

        // Register managed projects as entities in Knowledge Graph
        const managedProjects = typeof getProjects === "function" ? (getProjects() || []) : [];
        for (const proj of managedProjects.slice(0, 30)) {
            if (!proj?.name) continue;
            const entId = `project:${slugify(proj.name)}`;
            if (!graphStore.entities.some(e => e.id === entId)) {
                graphStore.entities.push({
                    id: entId,
                    name: proj.name,
                    type: "project",
                    mentions: 1,
                    createdAt: Date.now(),
                    lastSeenAt: Date.now(),
                });
            }
        }

        // Merge known dates from daily usage, history topics, fallback collector cache, and previously cached daily records
        const allDates = new Set(Object.keys(cache.dailyRecords));
        allDates.add(todayKey);
        for (const date of topicsByDate.keys()) allDates.add(date);
        for (const date of fallbackDailyTokens.keys()) allDates.add(date);
        for (const row of usageSnap.week?.daily || []) if (row.date) allDates.add(row.date);
        for (const report of Object.values(usageSnap.history || {})) {
            for (const row of report?.daily || []) if (row.date) allDates.add(row.date);
        }

        const dailyUsageTokens = new Map();
        for (const [date, tok] of fallbackDailyTokens.entries()) dailyUsageTokens.set(date, tok);
        for (const report of Object.values(usageSnap.history || {})) {
            for (const row of report?.daily || []) dailyUsageTokens.set(row.date, Math.max(dailyUsageTokens.get(row.date) || 0, row.tokens || 0));
        }
        for (const row of usageSnap.week?.daily || []) dailyUsageTokens.set(row.date, Math.max(dailyUsageTokens.get(row.date) || 0, row.tokens || 0));
        if (usageSnap.today?.total != null) dailyUsageTokens.set(todayKey, Math.max(dailyUsageTokens.get(todayKey) || 0, usageSnap.today.total));

        const writeCompressedArchive = (baseDir, relDir, stem, payloadObj, markdownText) => {
            const rawBuf = Buffer.from(JSON.stringify(payloadObj), "utf8");
            const gzBuf = zlib.gzipSync(rawBuf, { level: 9 });
            const dir = path.join(baseDir, relDir);
            const mdPath = path.join(dir, `${stem}.md`);
            const gzPath = path.join(dir, `${stem}.json.gz`);
            writeAtomic(mdPath, markdownText);
            writeAtomic(gzPath, gzBuf);
            return { mdPath, gzPath, rawBytes: rawBuf.length, compressedBytes: gzBuf.length };
        };

        let totalRaw = 0;
        let totalCompressed = 0;
        const dailyRecords = new Map();
        const dailyItems = [];

        for (const date of [...allDates].sort()) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
            const existing = cache.dailyRecords[date];
            const isToday = date === todayKey;
            const isPast = date < todayKey;
            // Union-merge topics so previously captured topics for a day are NEVER dropped on recomputation
            const mergedTopics = [];
            const seenTopicTexts = new Set();
            for (const t of [...(existing?.topics || []), ...(topicsByDate.get(date) || [])]) {
                if (!t?.text) continue;
                if (seenTopicTexts.has(t.text)) continue;
                seenTopicTexts.add(t.text);
                mergedTopics.push(t);
                if (mergedTopics.length >= 25) break;
            }
            const topics = mergedTopics;

            // Protect historical daily archives from retroactive token drops (non-regressing monotonic merge unless forceRebuild)
            const incomingTokens = dailyUsageTokens.has(date) ? dailyUsageTokens.get(date) : null;
            const prevTokens = Number(existing?.totalTokens) || 0;
            let tokens;
            if (opts.forceRebuild) {
                tokens = incomingTokens ?? prevTokens;
            } else if (isPast) {
                tokens = Math.max(prevTokens, incomingTokens ?? 0);
            } else {
                tokens = incomingTokens != null ? Math.max(prevTokens, incomingTokens) : prevTokens;
            }

            let tools = existing?.tools || [];
            let projects = existing?.projects || [];
            let totalSessions = existing?.totalSessions || 0;

            if (isToday && usageSnap.today) {
                const liveTools = Object.entries(usageSnap.today.totals || {})
                    .filter(([, v]) => v.tokens > 0 || v.sessions > 0)
                    .map(([source, v]) => ({ source, tokens: v.tokens, sessions: v.sessions }))
                    .sort((a, b) => b.tokens - a.tokens);
                if (liveTools.length) tools = liveTools;
                const liveProjects = (usageSnap.today.projects || []).slice(0, 20).map(pr => ({
                    name: pr.name,
                    directory: pr.directory,
                    tokens: pr.tokens,
                }));
                if (liveProjects.length) projects = liveProjects;
                const liveSessions = Object.values(usageSnap.today.totals || {}).reduce((s, x) => s + (x.sessions || 0), 0);
                totalSessions = Math.max(totalSessions, liveSessions);
            } else if (!projects.length && isToday) {
                projects = managedProjects.slice(0, 10).map(pr => ({ name: pr.name, directory: pr.directory, tokens: 0 }));
            }

            if (!isToday && tokens === 0 && !topics.length && !projects.length) continue;

            const settledAt = (isToday && opts.settle)
                ? Date.now()
                : (existing?.settledAt || (isPast && existing?.updatedAt ? existing.updatedAt : 0));

            const record = {
                date,
                week: isoWeekKey(date),
                month: monthKey(date),
                totalTokens: tokens,
                totalSessions,
                tools,
                projects,
                topics: topics.slice(0, 25),
                updatedAt: Date.now(),
                ...(settledAt ? { settledAt } : {}),
            };
            cache.dailyRecords[date] = record;
            dailyRecords.set(date, record);

            const res = writeCompressedArchive(p.dailyRoot, record.month, date, record, renderDailyMarkdown(record));
            totalRaw += res.rawBytes;
            totalCompressed += res.compressedBytes;
            dailyItems.push({
                kind: "daily",
                key: date,
                label: date,
                sub: `${fmtNum(record.totalTokens)} tok · ${record.topics.length} 要点`,
                mdPath: res.mdPath,
                gzPath: res.gzPath,
                rawBytes: res.rawBytes,
                compressedBytes: res.compressedBytes,
                updatedAt: record.updatedAt,
            });
        }

        const weekGroups = new Map();
        const monthGroups = new Map();
        for (const rec of dailyRecords.values()) {
            if (!weekGroups.has(rec.week)) weekGroups.set(rec.week, []);
            weekGroups.get(rec.week).push(rec);
            if (!monthGroups.has(rec.month)) monthGroups.set(rec.month, []);
            monthGroups.get(rec.month).push(rec);
        }

        const weeklyItems = [];
        for (const [wk, days] of [...weekGroups.entries()].sort()) {
            const { summary, ordered } = rollupRecords("weekly", wk, days);
            const res = writeCompressedArchive(p.weeklyRoot, wk.slice(0, 4), wk, summary, renderPeriodMarkdown("weekly", wk, ordered, summary));
            totalRaw += res.rawBytes;
            totalCompressed += res.compressedBytes;
            weeklyItems.push({
                kind: "weekly",
                key: wk,
                label: wk,
                sub: `${ordered.length} 天 · ${fmtNum(summary.totalTokens)} tok`,
                mdPath: res.mdPath,
                gzPath: res.gzPath,
                rawBytes: res.rawBytes,
                compressedBytes: res.compressedBytes,
                updatedAt: summary.updatedAt,
            });
        }

        const monthlyItems = [];
        for (const [mk, days] of [...monthGroups.entries()].sort()) {
            const { summary, ordered } = rollupRecords("monthly", mk, days);
            const res = writeCompressedArchive(p.monthlyRoot, mk.slice(0, 4), mk, summary, renderPeriodMarkdown("monthly", mk, ordered, summary));
            totalRaw += res.rawBytes;
            totalCompressed += res.compressedBytes;
            monthlyItems.push({
                kind: "monthly",
                key: mk,
                label: mk,
                sub: `${ordered.length} 天 · ${fmtNum(summary.totalTokens)} tok`,
                mdPath: res.mdPath,
                gzPath: res.gzPath,
                rawBytes: res.rawBytes,
                compressedBytes: res.compressedBytes,
                updatedAt: summary.updatedAt,
            });
        }

        // Hindsight Reflect on accumulated items & graph
        if (itemStore.items.some(i => i.status === "active")) {
            reflect({ _itemStore: itemStore, _graphStore: graphStore, _deferPersist: true });
        }

        // Persist compressed cognitive stores & materialize human-readable memU + OpenViking + Graphiti files
        const itemBytes = saveItemStore(itemStore, p);
        const graphBytes = saveGraphStore(graphStore, p);
        const resBytes = saveResourceStore(resStore, p);
        totalRaw += itemBytes.rawBytes + graphBytes.rawBytes + resBytes.rawBytes;
        totalCompressed += itemBytes.compressedBytes + graphBytes.compressedBytes + resBytes.compressedBytes;

        const cognitive = materializeViews(itemStore, graphStore, p);
        writeAtomic(p.cacheFile, JSON.stringify(cache));

        const ratio = totalRaw > 0 ? Math.max(0, Math.round((1 - totalCompressed / totalRaw) * 100)) : 0;
        const nextIndex = {
            version: 2,
            archiveDir: p.root,
            lastRun: Date.now(),
            rawBytes: totalRaw,
            compressedBytes: totalCompressed,
            compressionRatio: ratio,
            cacheHits: hits,
            cacheMisses: misses,
            ingestedItems,
            counts: {
                daily: dailyItems.length,
                weekly: weeklyItems.length,
                monthly: monthlyItems.length,
            },
            cognitive,
            items: {
                daily: dailyItems.reverse().slice(0, 60),
                weekly: weeklyItems.reverse().slice(0, 30),
                monthly: monthlyItems.reverse().slice(0, 24),
            },
        };
        writeAtomic(p.indexFile, JSON.stringify(nextIndex, null, 2) + "\n");
        return nextIndex;
    }

    function getStatus() {
        const p = pathsOf();
        const itemStore = loadItemStore(p);
        const graphStore = loadGraphStore(p);
        const saved = readJsonSafe(p.indexFile, null);
        const cognitive = computeCognitiveStats(itemStore, graphStore);
        return {
            archiveDir: p.root,
            engineVersion: ENGINE_VERSION,
            lastRun: saved?.lastRun || 0,
            compressionRatio: saved?.compressionRatio || 0,
            rawBytes: saved?.rawBytes || 0,
            compressedBytes: saved?.compressedBytes || 0,
            counts: saved?.counts || { daily: 0, weekly: 0, monthly: 0 },
            cognitive,
        };
    }

    function exportSyncBundle({ deviceId = "", deviceName = "" } = {}) {
        const p = pathsOf();
        const itemStore = loadItemStore(p);
        const graphStore = loadGraphStore(p);
        return {
            version: 2,
            engineVersion: ENGINE_VERSION,
            deviceId,
            deviceName,
            exportedAt: Date.now(),
            items: itemStore.items.slice(-500),
            entities: graphStore.entities.slice(-400),
            edges: graphStore.edges.slice(-800),
        };
    }

    function mergeSyncBundle(bundle) {
        if (!bundle || typeof bundle !== "object" || !Array.isArray(bundle.items)) {
            return { itemsAdded: 0, itemsUpdated: 0, entitiesAdded: 0, edgesAdded: 0, edgesUpdated: 0 };
        }
        const p = pathsOf();
        ensureDirs(p);
        const itemStore = loadItemStore(p);
        const graphStore = loadGraphStore(p);

        const itemById = new Map(itemStore.items.map(it => [it.id, it]));
        let itemsAdded = 0;
        let itemsUpdated = 0;

        for (const inc of bundle.items.slice(0, 600)) {
            if (!inc || typeof inc.id !== "string" || typeof inc.l0 !== "string") continue;
            const clean = {
                ...inc,
                title: sanitizeSnippet(inc.title || inc.l0, 90),
                l0: sanitizeSnippet(inc.l0, 160),
                l1: scrubSecrets(String(inc.l1 || inc.l0)).slice(0, 1200),
                l2: scrubSecrets(String(inc.l2 || inc.l1 || inc.l0)).slice(0, 12000),
            };
            const cur = itemById.get(clean.id);
            if (!cur) {
                itemStore.items.push(clean);
                itemById.set(clean.id, clean);
                itemsAdded++;
            } else {
                const incVer = Number(clean.version || 1);
                const curVer = Number(cur.version || 1);
                const incUpd = Number(clean.updatedAt || 0);
                const curUpd = Number(cur.updatedAt || 0);
                if (incVer > curVer || (incVer === curVer && incUpd > curUpd)) {
                    Object.assign(cur, clean, {
                        evidence: [...new Set([...(cur.evidence || []), ...(clean.evidence || [])])].slice(0, 20),
                        tags: [...new Set([...(cur.tags || []), ...(clean.tags || [])])].slice(0, 12),
                    });
                    itemsUpdated++;
                } else if (clean.status === "superseded" && cur.status === "active" && clean.validTo) {
                    cur.status = "superseded";
                    cur.validTo = clean.validTo;
                    cur.supersededBy = clean.supersededBy || cur.supersededBy;
                    itemsUpdated++;
                }
            }
        }

        const entById = new Map(graphStore.entities.map(e => [e.id, e]));
        let entitiesAdded = 0;
        for (const ent of Array.isArray(bundle.entities) ? bundle.entities.slice(0, 500) : []) {
            if (!ent || typeof ent.id !== "string" || typeof ent.name !== "string") continue;
            const cur = entById.get(ent.id);
            if (!cur) {
                graphStore.entities.push({ ...ent, name: sanitizeSnippet(ent.name, 64) });
                entById.set(ent.id, graphStore.entities.at(-1));
                entitiesAdded++;
            } else {
                cur.mentions = Math.max(cur.mentions || 1, ent.mentions || 1);
                cur.lastSeenAt = Math.max(cur.lastSeenAt || 0, ent.lastSeenAt || 0);
            }
        }

        const edgeById = new Map(graphStore.edges.map(e => [e.id, e]));
        const edgeByKey = new Map(graphStore.edges.map(e => [`${e.subjectId}|${e.predicate}|${e.objectId}|${e.validFrom || 0}`, e]));
        let edgesAdded = 0;
        let edgesUpdated = 0;
        for (const edge of Array.isArray(bundle.edges) ? bundle.edges.slice(0, 1000) : []) {
            if (!edge || typeof edge.subjectId !== "string" || typeof edge.predicate !== "string" || typeof edge.objectId !== "string") continue;
            const k = `${edge.subjectId}|${edge.predicate}|${edge.objectId}|${edge.validFrom || 0}`;
            const cur = (edge.id && edgeById.get(edge.id)) || edgeByKey.get(k);
            if (!cur) {
                graphStore.edges.push(edge);
                if (edge.id) edgeById.set(edge.id, edge);
                edgeByKey.set(k, edge);
                edgesAdded++;
            } else {
                let changed = false;
                if (edge.validTo && !cur.validTo) {
                    cur.validTo = edge.validTo;
                    cur.supersededBy = edge.supersededBy || cur.supersededBy;
                    changed = true;
                }
                const mergedEv = [...new Set([...(cur.evidence || []), ...(edge.evidence || [])])].slice(0, 20);
                if (mergedEv.length !== (cur.evidence || []).length) {
                    cur.evidence = mergedEv;
                    changed = true;
                }
                if (changed) edgesUpdated++;
            }
        }

        if (itemsAdded || itemsUpdated || entitiesAdded || edgesAdded || edgesUpdated) {
            saveItemStore(itemStore, p);
            saveGraphStore(graphStore, p);
            materializeViews(itemStore, graphStore, p);
            syncIndexCognitiveStats(itemStore, graphStore, p);
        }

        return { itemsAdded, itemsUpdated, entitiesAdded, edgesAdded, edgesUpdated };
    }

    /**
     * Auto-Forget Lifecycle Sweep (agentmemory-inspired: TTL expiry, contradiction detection, dormant working eviction)
     */
    function autoForget({ dryRun = false, dormantDays = 45 } = {}) {
        const p = pathsOf();
        ensureDirs(p);
        const itemStore = loadItemStore(p);
        const graphStore = loadGraphStore(p);
        const now = Date.now();

        const ttlExpired = [];
        const dormantEvicted = [];
        const contradictions = [];
        const active = itemStore.items.filter(i => i.status === "active");

        // 1. TTL expiry sweep
        for (const it of active) {
            if (it.forgetAfter && it.forgetAfter <= now) {
                ttlExpired.push({ id: it.id, uri: it.uri, title: it.title, forgetAfter: it.forgetAfter });
                if (!dryRun) {
                    it.status = "deleted";
                    it.validTo = now;
                    it.updatedAt = now;
                    it.deleteReason = "auto-forget TTL expired";
                    for (const edge of graphStore.edges) {
                        if (!edge.validTo && Array.isArray(edge.evidence) && edge.evidence.length === 1 && edge.evidence[0] === it.id) {
                            edge.validTo = now;
                        }
                    }
                }
            }
        }

        // 2. Dormant low-value working-tier eviction
        const remainingActive = itemStore.items.filter(i => i.status === "active");
        for (const it of remainingActive) {
            const tier = it.tier || classifyTier(it.bank, it.category, it.scope, it.memoryType);
            const ret = computeRetention(it, now);
            if (tier === "working" && ret.temperature === "dormant" && ret.ageDays >= dormantDays) {
                dormantEvicted.push({ id: it.id, uri: it.uri, title: it.title, retentionScore: ret.retentionScore, ageDays: ret.ageDays });
                if (!dryRun) {
                    it.status = "superseded";
                    it.validTo = now;
                    it.updatedAt = now;
                    it.deleteReason = "auto-forget dormant working memory";
                }
            }
        }

        // 3. Contradiction detector across active non-reflection memories in same scope + project
        const pool = itemStore.items
            .filter(i => i.status === "active" && i.bank !== "observation" && i.bank !== "mental_model")
            .slice(-250);
        const tokCache = new Map(pool.map(m => [m.id, tokenize(`${m.title} ${m.l1}`)]));
        for (let i = 0; i < pool.length; i++) {
            for (let j = i + 1; j < pool.length; j++) {
                const a = pool[i];
                const b = pool[j];
                if (a.scope !== b.scope || (a.project || "") !== (b.project || "")) continue;
                const sim = jaccardSimilarity(tokCache.get(a.id), tokCache.get(b.id));
                const negDiff = (/(?:不要|禁止|不用|弃用|avoid|never|not|don't)/i.test(a.l1)) !== (/(?:不要|禁止|不用|弃用|avoid|never|not|don't)/i.test(b.l1));
                if (sim >= 0.78 || (sim >= 0.52 && negDiff)) {
                    contradictions.push({
                        memoryA: { id: a.id, title: a.title, updatedAt: a.updatedAt },
                        memoryB: { id: b.id, title: b.title, updatedAt: b.updatedAt },
                        similarity: Number(sim.toFixed(2)),
                        reason: negDiff ? "polarity_conflict" : "near_duplicate_conflict",
                    });
                    if (contradictions.length >= 20) break;
                }
            }
            if (contradictions.length >= 20) break;
        }

        if (!dryRun && (ttlExpired.length || dormantEvicted.length)) {
            saveItemStore(itemStore, p);
            saveGraphStore(graphStore, p);
            materializeViews(itemStore, graphStore, p);
            syncIndexCognitiveStats(itemStore, graphStore, p);
        }

        return {
            dryRun,
            ttlExpired,
            dormantEvicted,
            contradictions,
            cleanedCount: dryRun ? 0 : (ttlExpired.length + dormantEvicted.length),
        };
    }

    /**
     * SessionStart Project / User Profile Briefing (agentmemory-inspired token-budgeted context injection)
     */
    function profile({ project = "", tokenBudget = 1200 } = {}) {
        const p = pathsOf();
        const itemStore = loadItemStore(p);
        const graphStore = loadGraphStore(p);
        const now = Date.now();
        const projLower = String(project || "").trim().toLowerCase();

        const scoped = itemStore.items
            .filter(i => i.status === "active" && (!i.forgetAfter || i.forgetAfter > now))
            .filter(i => !projLower || (i.project || "").toLowerCase() === projLower || i.scope === "user")
            .map(i => ({ item: i, ret: computeRetention(i, now) }))
            .sort((a, b) => b.ret.retentionScore - a.ret.retentionScore || (b.item.updatedAt || 0) - (a.item.updatedAt || 0));

        const preferences = scoped.filter(x => x.item.bank === "opinion").slice(0, 6);
        const lessons = scoped.filter(x => resolveMemoryLayer(x.item) === "lesson").slice(0, 6);
        const decisions = scoped.filter(x => x.item.category === "decisions" || x.item.bank === "world").slice(0, 8);
        const topEntities = [...graphStore.entities]
            .sort((a, b) => (b.mentions || 0) - (a.mentions || 0))
            .slice(0, 12)
            .map(e => ({ name: e.name, type: e.type, mentions: e.mentions || 1 }));

        const lines = [
            `# QLEX 上下文画像${project ? ` · ${project}` : "（全局）"}`,
            `- 活跃记忆：${scoped.length} 条 · 偏好 ${preferences.length} · 教训 ${lessons.length} · 决策/事实 ${decisions.length}`,
            topEntities.length ? `- 核心实体：${topEntities.slice(0, 8).map(e => e.name).join("、")}` : "",
            "",
        ].filter(x => x !== "");

        const pushSection = (title, list) => {
            if (!list.length) return;
            lines.push(`## ${title}`);
            for (const { item, ret } of list) {
                const candidate = `- [${ret.temperature}/${Math.round((item.confidence ?? 0.8) * 100)}%] **${item.title}**：${item.l0} (\`${item.id}\`)`;
                if (estimateTokens(lines.join("\n") + "\n" + candidate) > tokenBudget) break;
                lines.push(candidate);
            }
            lines.push("");
        };

        pushSection("用户偏好与长期约束", preferences);
        pushSection("高频教训与排错经验 (Procedural Lessons)", lessons);
        pushSection("关键决策与事实 (Semantic Memory)", decisions);

        const text = lines.join("\n").trim();
        return {
            project: project || null,
            token_budget: tokenBudget,
            tokens_used: estimateTokens(text),
            counts: {
                totalScoped: scoped.length,
                preferences: preferences.length,
                lessons: lessons.length,
                decisions: decisions.length,
            },
            topEntities,
            text,
        };
    }

    /**
     * Memory Health Diagnostics (agentmemory doctor/diagnose style)
     */
    function diagnose() {
        const st = getStatus();
        const sweepPreview = autoForget({ dryRun: true });
        const cog = st.cognitive;
        const recommendations = [];
        if (sweepPreview.ttlExpired.length > 0) {
            recommendations.push(`发现 ${sweepPreview.ttlExpired.length} 条已超过 TTL 的记忆，建议执行 autoForget 清理。`);
        }
        if (sweepPreview.contradictions.length > 0) {
            recommendations.push(`检测到 ${sweepPreview.contradictions.length} 组潜在冲突/高度重复记忆，建议核对或使用 factKey 触发演进替代。`);
        }
        if (cog.activeItems >= 5 && cog.reflectionsCount === 0) {
            recommendations.push("尚未生成反思洞察与心智模型，建议执行 reflect 提炼跨会话规律。");
        }
        if (!recommendations.length) {
            recommendations.push("记忆库健康状况良好：RRF 混合检索、Ebbinghaus 衰减与双时态图谱均运行正常。");
        }
        return {
            engineVersion: ENGINE_VERSION,
            archiveDir: st.archiveDir,
            healthScore: Math.max(40, 100 - sweepPreview.ttlExpired.length * 5 - Math.min(25, sweepPreview.contradictions.length * 5)),
            cognitive: cog,
            ttlExpiredCount: sweepPreview.ttlExpired.length,
            dormantWorkingCount: sweepPreview.dormantEvicted.length,
            contradictionsCount: sweepPreview.contradictions.length,
            contradictions: sweepPreview.contradictions.slice(0, 8),
            recommendations,
        };
    }

    return {
        pathsOf,
        retain,
        saveLesson,
        recall,
        reflect,
        forget,
        autoForget,
        profile,
        diagnose,
        graphQuery,
        browse,
        compressSync,
        getStatus,
        exportSyncBundle,
        mergeSyncBundle,
    };
}

module.exports = {
    ENGINE_VERSION,
    VALID_BANKS,
    VALID_SCOPES,
    VALID_LEVELS,
    VALID_TIERS,
    VALID_LAYERS,
    VALID_FORMATS,
    SOURCE_NAMES,
    DEFAULT_DECAY,
    createCognitiveMemoryEngine,
    resolveDefaultMemoryDir,
    computeRetention,
    scrubSecrets,
    sanitizeSnippet,
    isoWeekKey,
    localDateKey,
    tokenize,
    slugify,
};
