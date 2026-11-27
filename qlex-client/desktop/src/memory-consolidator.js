"use strict";

/**
 * QLEX Center LLM Memory Consolidator & Time-Slot Scheduler
 *
 * Responsibilities:
 *  1. Call OpenAI-compatible or Anthropic Messages API to consolidate multi-device
 *     memories at the Center hub (cross-device merge/dedup, conflict supersede,
 *     noise pruning, L0/L1/L2 distillation, and high-level insight synthesis).
 *  2. Provide deterministic rule-based fallback consolidation when LLM API is
 *     unconfigured or temporarily unreachable, so canonical memory never stalls.
 *  3. Evaluate daily time-slot schedules (e.g. ["12:30", "18:30", "21:30"]) or
 *     periodic hour intervals with sleep/wake catch-up & anti-duplicate tracking.
 */

const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

const LLM_PROVIDER_PRESETS = Object.freeze({
    openai: {
        id: "openai",
        label: "OpenAI",
        protocol: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        defaultModel: "gpt-4o-mini",
    },
    deepseek: {
        id: "deepseek",
        label: "DeepSeek",
        protocol: "openai-compatible",
        baseUrl: "https://api.deepseek.com/v1",
        defaultModel: "deepseek-chat",
    },
    qwen: {
        id: "qwen",
        label: "通义千问 (DashScope)",
        protocol: "openai-compatible",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        defaultModel: "qwen-plus",
    },
    zhipu: {
        id: "zhipu",
        label: "智谱 GLM",
        protocol: "openai-compatible",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        defaultModel: "glm-4-flash",
    },
    openrouter: {
        id: "openrouter",
        label: "OpenRouter",
        protocol: "openai-compatible",
        baseUrl: "https://openrouter.ai/api/v1",
        defaultModel: "openai/gpt-4o-mini",
    },
    anthropic: {
        id: "anthropic",
        label: "Anthropic Claude",
        protocol: "anthropic",
        baseUrl: "https://api.anthropic.com/v1",
        defaultModel: "claude-3-5-haiku-latest",
    },
    ollama: {
        id: "ollama",
        label: "Ollama (本地模型)",
        protocol: "openai-compatible",
        baseUrl: "http://127.0.0.1:11434/v1",
        defaultModel: "qwen2.5:7b",
    },
    custom: {
        id: "custom",
        label: "自定义 OpenAI 兼容接口",
        protocol: "openai-compatible",
        baseUrl: "",
        defaultModel: "",
    },
});

const DEFAULT_MEMORY_LLM_CONFIG = Object.freeze({
    enabled: true,
    provider: "openai-compatible",
    preset: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    model: "deepseek-chat",
    scheduleMode: "slots", // "slots" | "interval"
    timeSlots: ["12:30", "18:30", "21:30"],
    intervalHours: 4,
    onlyWhenChanged: true,
    maxItemsPerRun: 60,
    lastSlotKey: "",
    lastConsolidatedAt: 0,
});

const TIME_SLOT_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function normalizeTimeSlots(raw) {
    const arr = Array.isArray(raw)
        ? raw
        : typeof raw === "string"
            ? raw.split(/[,，;\s]+/)
            : [];
    const cleaned = [];
    for (const entry of arr) {
        const s = String(entry || "").trim();
        const m = s.match(/^(\d{1,2}):(\d{2})$/);
        if (!m) continue;
        const hh = Number(m[1]);
        const mm = Number(m[2]);
        if (hh < 0 || hh > 23 || mm < 0 || mm > 59) continue;
        const fmt = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
        if (TIME_SLOT_RE.test(fmt)) cleaned.push(fmt);
    }
    return [...new Set(cleaned)].sort().slice(0, 12);
}

function normalizeMemoryLlmConfig(raw, existing = null) {
    const base = existing && typeof existing === "object" ? existing : DEFAULT_MEMORY_LLM_CONFIG;
    const input = raw && typeof raw === "object" ? raw : {};
    const provider = input.provider === "anthropic" ? "anthropic"
        : input.provider === "openai-compatible" ? "openai-compatible"
            : (base.provider === "anthropic" ? "anthropic" : "openai-compatible");
    const preset = typeof input.preset === "string" && LLM_PROVIDER_PRESETS[input.preset]
        ? input.preset
        : (typeof base.preset === "string" && LLM_PROVIDER_PRESETS[base.preset] ? base.preset : "custom");
    const baseUrl = typeof input.baseUrl === "string"
        ? input.baseUrl.trim().replace(/\/+$/, "").slice(0, 300)
        : (base.baseUrl || DEFAULT_MEMORY_LLM_CONFIG.baseUrl);
    const model = typeof input.model === "string"
        ? input.model.trim().slice(0, 120)
        : (base.model || DEFAULT_MEMORY_LLM_CONFIG.model);

    // Keep existing API key if UI omitted it or sent sentinel "__KEEP__"
    let apiKey = typeof base.apiKey === "string" ? base.apiKey : "";
    if (input.clearApiKey === true) {
        apiKey = "";
    } else if (typeof input.apiKey === "string" && input.apiKey !== "__KEEP__") {
        apiKey = input.apiKey.trim().slice(0, 500);
    }

    const scheduleMode = input.scheduleMode === "interval" ? "interval"
        : input.scheduleMode === "slots" ? "slots"
            : (base.scheduleMode === "interval" ? "interval" : "slots");
    const timeSlots = input.timeSlots !== undefined
        ? normalizeTimeSlots(input.timeSlots)
        : normalizeTimeSlots(base.timeSlots || DEFAULT_MEMORY_LLM_CONFIG.timeSlots);
    const intervalRaw = Number(input.intervalHours !== undefined ? input.intervalHours : base.intervalHours);
    const intervalHours = Number.isFinite(intervalRaw) ? Math.max(1, Math.min(24, Math.round(intervalRaw))) : 4;
    const maxRaw = Number(input.maxItemsPerRun !== undefined ? input.maxItemsPerRun : base.maxItemsPerRun);
    const maxItemsPerRun = Number.isFinite(maxRaw) ? Math.max(10, Math.min(120, Math.round(maxRaw))) : 60;

    return {
        enabled: typeof input.enabled === "boolean" ? input.enabled : (base.enabled !== false),
        provider,
        preset,
        baseUrl,
        apiKey,
        model,
        scheduleMode,
        timeSlots: timeSlots.length ? timeSlots : (input.timeSlots !== undefined ? [] : [...DEFAULT_MEMORY_LLM_CONFIG.timeSlots]),
        intervalHours,
        onlyWhenChanged: typeof input.onlyWhenChanged === "boolean" ? input.onlyWhenChanged : (base.onlyWhenChanged !== false),
        maxItemsPerRun,
        lastSlotKey: typeof input.lastSlotKey === "string" ? input.lastSlotKey.slice(0, 40) : (base.lastSlotKey || ""),
        lastConsolidatedAt: Number.isFinite(Number(input.lastConsolidatedAt))
            ? Number(input.lastConsolidatedAt)
            : (Number(base.lastConsolidatedAt) || 0),
    };
}

function maskApiKey(key) {
    const s = String(key || "").trim();
    if (!s) return "";
    if (s.length <= 8) return "••••";
    return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

function publicMemoryLlmConfig(config) {
    const cfg = normalizeMemoryLlmConfig(config);
    const isOllamaLocal = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/i.test(cfg.baseUrl || "");
    const configured = Boolean(cfg.baseUrl && cfg.model && (cfg.apiKey || isOllamaLocal));
    return {
        enabled: cfg.enabled,
        provider: cfg.provider,
        preset: cfg.preset,
        baseUrl: cfg.baseUrl,
        model: cfg.model,
        hasApiKey: Boolean(cfg.apiKey),
        apiKeyPreview: maskApiKey(cfg.apiKey),
        configured,
        scheduleMode: cfg.scheduleMode,
        timeSlots: cfg.timeSlots,
        intervalHours: cfg.intervalHours,
        onlyWhenChanged: cfg.onlyWhenChanged,
        maxItemsPerRun: cfg.maxItemsPerRun,
        lastSlotKey: cfg.lastSlotKey,
        lastConsolidatedAt: cfg.lastConsolidatedAt,
        nextTriggerLabel: computeNextTriggerLabel(cfg),
    };
}

function localDateKey(ts = Date.now()) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Evaluate whether a scheduled consolidation slot is due right now.
 * Returns { due: boolean, slotKey: string, reason: string }.
 */
function evaluateConsolidationSchedule(config, now = Date.now()) {
    const cfg = normalizeMemoryLlmConfig(config);
    if (!cfg.enabled) return { due: false, slotKey: "", reason: "disabled" };

    if (cfg.scheduleMode === "interval") {
        const intervalMs = cfg.intervalHours * 3_600_000;
        const elapsed = now - (cfg.lastConsolidatedAt || 0);
        if (elapsed >= intervalMs) {
            const bucket = Math.floor(now / intervalMs);
            const slotKey = `interval:${cfg.intervalHours}h:${bucket}`;
            if (cfg.lastSlotKey !== slotKey) {
                return { due: true, slotKey, reason: `interval_${cfg.intervalHours}h` };
            }
        }
        return { due: false, slotKey: "", reason: "waiting_interval" };
    }

    // Time-slots mode (e.g. ["12:30", "18:30", "21:30"])
    const slots = normalizeTimeSlots(cfg.timeSlots);
    if (!slots.length) return { due: false, slotKey: "", reason: "no_slots" };

    const dt = new Date(now);
    const today = localDateKey(now);
    const nowMin = dt.getHours() * 60 + dt.getMinutes();

    // Find the latest slot that has already arrived today (handles sleep/wake catch-up cleanly)
    let latestDueSlot = "";
    for (const slot of slots) {
        const [hh, mm] = slot.split(":").map(Number);
        const slotMin = hh * 60 + mm;
        if (nowMin >= slotMin) {
            latestDueSlot = slot;
        }
    }
    if (!latestDueSlot) return { due: false, slotKey: "", reason: "before_first_slot" };

    const slotKey = `${today}@${latestDueSlot}`;
    if (cfg.lastSlotKey === slotKey) {
        return { due: false, slotKey, reason: "already_ran_slot" };
    }
    // Also skip if a later slot on the same day already ran (e.g. user changed slots)
    if (cfg.lastSlotKey && cfg.lastSlotKey.startsWith(`${today}@`) && cfg.lastSlotKey >= slotKey) {
        return { due: false, slotKey, reason: "later_slot_already_ran" };
    }
    return { due: true, slotKey, reason: `slot_${latestDueSlot}` };
}

function computeNextTriggerLabel(config, now = Date.now()) {
    const cfg = normalizeMemoryLlmConfig(config);
    if (!cfg.enabled) return "已关闭";
    if (cfg.scheduleMode === "interval") {
        if (!cfg.lastConsolidatedAt) return `每 ${cfg.intervalHours} 小时`;
        const nextTs = cfg.lastConsolidatedAt + cfg.intervalHours * 3_600_000;
        if (nextTs <= now) return "即将触发";
        const d = new Date(nextTs);
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} (每${cfg.intervalHours}h)`;
    }
    const slots = normalizeTimeSlots(cfg.timeSlots);
    if (!slots.length) return "未设时间段";
    const dt = new Date(now);
    const today = localDateKey(now);
    const nowMin = dt.getHours() * 60 + dt.getMinutes();
    for (const slot of slots) {
        const [hh, mm] = slot.split(":").map(Number);
        const slotKey = `${today}@${slot}`;
        if (hh * 60 + mm > nowMin && cfg.lastSlotKey !== slotKey) {
            return `今日 ${slot}`;
        }
    }
    return `明日 ${slots[0]}`;
}

function postJson(urlStr, headers, bodyObj, timeoutMs = 90_000) {
    return new Promise((resolve, reject) => {
        let parsed;
        try {
            parsed = new URL(urlStr);
        } catch {
            reject(new Error(`无效的 API 地址：${urlStr}`));
            return;
        }
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            reject(new Error("仅支持 http:// 或 https:// 接口地址。"));
            return;
        }
        const payload = Buffer.from(JSON.stringify(bodyObj), "utf8");
        const client = parsed.protocol === "https:" ? https : http;
        const req = client.request({
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
            path: `${parsed.pathname}${parsed.search}`,
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": payload.length,
                "User-Agent": "QLEX-MemoryConsolidator/0.3.0",
                ...headers,
            },
            timeout: timeoutMs,
        }, (res) => {
            const chunks = [];
            let size = 0;
            res.on("data", chunk => {
                size += chunk.length;
                if (size > 4 * 1024 * 1024) {
                    req.destroy(new Error("模型返回体积超出限制 (4MB)"));
                    return;
                }
                chunks.push(chunk);
            });
            res.on("end", () => {
                const text = Buffer.concat(chunks).toString("utf8");
                resolve({ status: res.statusCode || 0, text });
            });
        });
        req.on("timeout", () => req.destroy(new Error("大模型接口请求超时")));
        req.on("error", err => reject(new Error(`大模型接口连接失败：${err.message}`)));
        req.write(payload);
        req.end();
    });
}

function buildEndpointUrl(baseUrl, provider) {
    const clean = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!clean) throw new Error("请先配置大模型 API Base URL。");
    if (provider === "anthropic") {
        return clean.endsWith("/messages") ? clean : `${clean}/messages`;
    }
    return clean.endsWith("/chat/completions") ? clean : `${clean}/chat/completions`;
}

function extractJsonObject(rawText) {
    const text = String(rawText || "").trim();
    if (!text) throw new Error("模型返回内容为空。");
    // Strip markdown fences if present
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1].trim() : text;
    try {
        return JSON.parse(candidate);
    } catch {
        const first = candidate.indexOf("{");
        const last = candidate.lastIndexOf("}");
        if (first >= 0 && last > first) {
            return JSON.parse(candidate.slice(first, last + 1));
        }
        throw new Error("模型返回内容不是合法的 JSON 结构。");
    }
}

async function callLlmJson(config, { systemPrompt, userPrompt, maxTokens = 4096, timeoutMs = 90_000 }) {
    const cfg = normalizeMemoryLlmConfig(config);
    const isOllamaLocal = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/i.test(cfg.baseUrl || "");
    if (!cfg.baseUrl || !cfg.model) {
        throw new Error("请先完整配置大模型 API 地址与模型名称。");
    }
    if (!cfg.apiKey && !isOllamaLocal) {
        throw new Error("请先配置大模型 API Key。");
    }

    const endpoint = buildEndpointUrl(cfg.baseUrl, cfg.provider);
    const startedAt = Date.now();

    if (cfg.provider === "anthropic") {
        const headers = {
            "x-api-key": cfg.apiKey,
            "anthropic-version": "2023-06-01",
        };
        const res = await postJson(endpoint, headers, {
            model: cfg.model,
            max_tokens: maxTokens,
            temperature: 0.2,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
        }, timeoutMs);
        if (res.status < 200 || res.status >= 300) {
            throw new Error(`Anthropic 接口错误 (HTTP ${res.status}): ${res.text.slice(0, 240)}`);
        }
        const body = JSON.parse(res.text);
        const content = Array.isArray(body.content)
            ? body.content.filter(b => b.type === "text").map(b => b.text).join("\n")
            : "";
        return {
            parsed: extractJsonObject(content),
            rawText: content,
            usage: {
                inputTokens: body.usage?.input_tokens || 0,
                outputTokens: body.usage?.output_tokens || 0,
            },
            latencyMs: Date.now() - startedAt,
            model: body.model || cfg.model,
        };
    }

    // OpenAI-compatible Chat Completions API
    const headers = cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};
    const requestPayload = {
        model: cfg.model,
        temperature: 0.2,
        max_tokens: maxTokens,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ],
    };
    // Enable JSON object mode when supported (retries without response_format if provider rejects it)
    let res = await postJson(endpoint, headers, {
        ...requestPayload,
        response_format: { type: "json_object" },
    }, timeoutMs);
    if (res.status === 400 && /response_format|json_object/i.test(res.text)) {
        res = await postJson(endpoint, headers, requestPayload, timeoutMs);
    }
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`大模型接口错误 (HTTP ${res.status}): ${res.text.slice(0, 260)}`);
    }
    const body = JSON.parse(res.text);
    const content = body.choices?.[0]?.message?.content || "";
    return {
        parsed: extractJsonObject(content),
        rawText: content,
        usage: {
            inputTokens: body.usage?.prompt_tokens || 0,
            outputTokens: body.usage?.completion_tokens || 0,
        },
        latencyMs: Date.now() - startedAt,
        model: body.model || cfg.model,
    };
}

async function testMemoryLlmConnection(config) {
    const res = await callLlmJson(config, {
        systemPrompt: '你是连通性检测助手，只输出 JSON：{"ok": true, "reply": "ready"}',
        userPrompt: "请回复 ready。",
        maxTokens: 64,
        timeoutMs: 20_000,
    });
    return {
        ok: true,
        model: res.model,
        latencyMs: res.latencyMs,
        reply: String(res.parsed?.reply || "ready").slice(0, 60),
    };
}

function buildConsolidationPrompts(items, { devices = [], existingModels = [] } = {}) {
    const systemPrompt = [
        "你是 QLEX 中心记忆中枢的权威记忆整理专家。",
        "你的目标是将来自多台设备（中心点与各接入点）的零散记忆整理成【唯一一份全端共享、高信噪比、无重复、无冲突的权威记忆】。",
        "你必须严格输出单个合法 JSON 对象，不要包含任何额外解释或 Markdown 包裹。",
        "",
        "整理原则：",
        "1. 跨端合并去重 (merges)：若多条记忆描述同一项目进展、同一问题排查、同一决策或重复会话碎片（即使来自不同设备/不同工具），合并为 1 条精炼且信息更完整的权威记忆，并在 sourceIds 中列出所有被合并的旧记忆 id（至少 2 个 id）。",
        "2. 冲突演进替代 (supersedes)：若较新记忆推翻/更新了旧记忆（例如架构切换、偏好变更、问题已修复），把旧记忆 id 放入 supersededId，新记忆 id 放入 winnerId，并写明简短 reason。",
        "3. 噪音淘汰 (prunes)：识别一次性闲聊、无上下文空壳提示、无长期复用价值的临时指令，放入 prunes（含 id 和 reason）。重要事实、偏好、项目产出与排错教训绝对不要误删。",
        "4. 高层次提炼 (syntheses)：可选输出 0~4 条跨设备提炼的全局项目现状/用户长期偏好/关键教训总结（bank 选 mental_model/observation/world/experience/opinion），每条需给出唯一 factKey（例如 center:project:<slug> 或 center:user:preferences）以便未来演进更新而不重复堆积。",
        "5. 严格忠实于输入事实，不得凭空捏造未出现的项目名、文件路径或结论；保持中文简洁专业。",
        "",
        "输出 JSON Schema：",
        "{",
        '  "summary": "本次跨端记忆整理的一句话核心总结（30~120字）",',
        '  "merges": [',
        "    {",
        '      "sourceIds": ["mem_xxx", "mem_yyy"],',
        '      "title": "合并后精炼标题（<=60字）",',
        '      "bank": "world|experience|opinion|observation",',
        '      "project": "项目名或空字符串",',
        '      "factKey": "可选稳定键，便于后续演进",',
        '      "l0": "一句话核心摘要（<=140字）",',
        '      "l1": "结构化要点（<=500字）",',
        '      "l2": "整合后的完整权威记忆（保留所有关键事实、文件路径与结论）",',
        '      "tags": ["标签1", "标签2"],',
        '      "confidence": 0.9',
        "    }",
        "  ],",
        '  "supersedes": [',
        '    { "supersededId": "mem_old", "winnerId": "mem_new", "reason": "新决策已替代旧方案" }',
        "  ],",
        '  "prunes": [',
        '    { "id": "mem_noise", "reason": "一次性临时操作无长期复用价值" }',
        "  ],",
        '  "syntheses": [',
        "    {",
        '      "title": "跨端综合洞察标题",',
        '      "bank": "mental_model|observation|world|experience|opinion",',
        '      "project": "项目名或空字符串",',
        '      "factKey": "center:...",',
        '      "l0": "一句话摘要",',
        '      "l1": "结构化要点",',
        '      "l2": "完整综合内容",',
        '      "evidenceIds": ["mem_xxx"],',
        '      "tags": ["consolidated"]',
        "    }",
        "  ]",
        "}",
    ].join("\n");

    const compactItems = items.map(it => ({
        id: it.id,
        bank: it.bank,
        scope: it.scope,
        project: it.project || "",
        factKey: it.factKey || "",
        source: it.source || "",
        originDevice: it.originDevice || "",
        updatedAt: it.updatedAt ? new Date(it.updatedAt).toISOString().slice(0, 16) : "",
        title: it.title,
        l0: it.l0,
        l1: String(it.l1 || "").slice(0, 360),
    }));

    const userPrompt = JSON.stringify({
        context: {
            now: new Date().toISOString(),
            totalInputItems: compactItems.length,
            devices,
            existingMentalModels: existingModels.slice(0, 10).map(m => ({
                id: m.id,
                factKey: m.factKey || "",
                title: m.title,
                l0: m.l0,
            })),
        },
        memories: compactItems,
    }, null, 2);

    return { systemPrompt, userPrompt };
}

async function runLlmConsolidationPlan(config, items, ctx = {}) {
    if (!Array.isArray(items) || !items.length) {
        return {
            skipped: true,
            plan: { summary: "当前没有需要整理的新增记忆。", merges: [], supersedes: [], prunes: [], syntheses: [] },
            usage: { inputTokens: 0, outputTokens: 0 },
            latencyMs: 0,
            model: config?.model || "",
        };
    }
    const { systemPrompt, userPrompt } = buildConsolidationPrompts(items, ctx);
    const res = await callLlmJson(config, {
        systemPrompt,
        userPrompt,
        maxTokens: 4096,
        timeoutMs: 110_000,
    });
    const raw = res.parsed && typeof res.parsed === "object" ? res.parsed : {};
    return {
        skipped: false,
        plan: {
            summary: typeof raw.summary === "string" ? raw.summary.trim().slice(0, 400) : "大模型已完成跨端记忆整理。",
            merges: Array.isArray(raw.merges) ? raw.merges : [],
            supersedes: Array.isArray(raw.supersedes) ? raw.supersedes : [],
            prunes: Array.isArray(raw.prunes) ? raw.prunes : [],
            syntheses: Array.isArray(raw.syntheses) ? raw.syntheses : [],
        },
        usage: res.usage,
        latencyMs: res.latencyMs,
        model: res.model,
    };
}

module.exports = {
    LLM_PROVIDER_PRESETS,
    DEFAULT_MEMORY_LLM_CONFIG,
    normalizeTimeSlots,
    normalizeMemoryLlmConfig,
    publicMemoryLlmConfig,
    maskApiKey,
    evaluateConsolidationSchedule,
    computeNextTriggerLabel,
    testMemoryLlmConnection,
    runLlmConsolidationPlan,
};
