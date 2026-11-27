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

function sanitizeJsonText(text) {
    // 1. Escape unescaped control characters inside JSON string literals
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const code = text.charCodeAt(i);
        if (inString) {
            if (escaped) {
                out += ch;
                escaped = false;
            } else if (ch === "\\") {
                out += ch;
                escaped = true;
            } else if (ch === '"') {
                out += ch;
                inString = false;
            } else if (ch === "\n") {
                out += "\\n";
            } else if (ch === "\r") {
                out += "\\r";
            } else if (ch === "\t") {
                out += "\\t";
            } else if (code < 0x20) {
                out += " ";
            } else {
                out += ch;
            }
        } else {
            if (ch === '"') inString = true;
            out += ch;
        }
    }
    // 2. Remove trailing commas before ] or } (safe outside strings via simple pass)
    let cleaned = "";
    inString = false;
    escaped = false;
    for (let i = 0; i < out.length; i++) {
        const ch = out[i];
        if (inString) {
            cleaned += ch;
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') inString = false;
            continue;
        }
        if (ch === '"') {
            inString = true;
            cleaned += ch;
            continue;
        }
        if (ch === ",") {
            let j = i + 1;
            while (j < out.length && /\s/.test(out[j])) j++;
            if (out[j] === "}" || out[j] === "]") {
                continue; // skip trailing comma
            }
        }
        cleaned += ch;
    }
    return cleaned;
}

function recoverTruncatedJson(raw) {
    const start = raw.indexOf("{");
    if (start < 0) return null;
    const text = sanitizeJsonText(raw.slice(start));

    // Walk token structure, recording every safe boundary where an object/array/string completes
    const stack = [];
    let inString = false;
    let escaped = false;
    const checkpoints = [];

    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
        } else if (ch === "{" || ch === "[") {
            stack.push(ch);
        } else if (ch === "}" || ch === "]") {
            const expected = ch === "}" ? "{" : "[";
            if (stack.length && stack[stack.length - 1] === expected) {
                stack.pop();
                // Closing an object inside an array or a top-level property array is a safe recovery boundary
                checkpoints.push({ pos: i + 1, openStack: [...stack] });
                if (stack.length === 0) {
                    try {
                        return JSON.parse(text.slice(0, i + 1));
                    } catch {
                        // keep scanning/fallback
                    }
                }
            }
        }
    }

    // Try closing from the latest safe checkpoint backwards (handles truncation inside any array element or string)
    for (let k = checkpoints.length - 1; k >= 0; k--) {
        const cp = checkpoints[k];
        const prefix = text.slice(0, cp.pos).replace(/,\s*$/, "");
        const closing = [...cp.openStack].reverse().map(c => (c === "{" ? "}" : "]")).join("");
        const candidate = `${prefix}${closing}`;
        try {
            const parsed = JSON.parse(candidate);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                return parsed;
            }
        } catch {
            // try earlier checkpoint
        }
    }
    return null;
}

function extractJsonObject(rawText) {
    const text = String(rawText || "").trim();
    if (!text) throw new Error("模型返回内容为空。");

    // Strip markdown code fences (even if closing ``` was truncated)
    let candidate = text;
    const fullFence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fullFence) {
        candidate = fullFence[1].trim();
    } else if (/^```(?:json)?\s*/i.test(text)) {
        candidate = text.replace(/^```(?:json)?\s*/i, "").trim();
    }

    // 1. Strict parse
    try {
        const obj = JSON.parse(candidate);
        if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    } catch { /* fallback to repair */ }

    // 2. Sanitized parse (escapes raw newlines/tabs inside strings + strips trailing commas)
    const sanitized = sanitizeJsonText(candidate);
    try {
        const obj = JSON.parse(sanitized);
        if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    } catch { /* fallback to substring / truncation recovery */ }

    // 3. Balanced substring & truncation-safe recovery (prevents cutting into open arrays!)
    const recovered = recoverTruncatedJson(candidate);
    if (recovered) return recovered;

    throw new Error("模型返回内容无法解析为合法 JSON（可能输出被截断或格式异常）。");
}

async function callLlmJson(config, { systemPrompt, userPrompt, maxTokens = 8192, timeoutMs = 90_000 }) {
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
        let res = await postJson(endpoint, headers, {
            model: cfg.model,
            max_tokens: maxTokens,
            temperature: 0.2,
            system: systemPrompt,
            messages: [{ role: "user", content: userPrompt }],
        }, timeoutMs);
        if (res.status === 400 && maxTokens > 4096 && /max_tokens/i.test(res.text)) {
            res = await postJson(endpoint, headers, {
                model: cfg.model,
                max_tokens: 4096,
                temperature: 0.2,
                system: systemPrompt,
                messages: [{ role: "user", content: userPrompt }],
            }, timeoutMs);
        }
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
            truncated: body.stop_reason === "max_tokens",
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
    const makePayload = (tokens, withJsonMode) => ({
        model: cfg.model,
        temperature: 0.2,
        max_tokens: tokens,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
        ],
        ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
    });

    // Enable JSON object mode when supported; gracefully degrade max_tokens / response_format on HTTP 400
    let curMaxTokens = maxTokens;
    let useJsonMode = true;
    let res = await postJson(endpoint, headers, makePayload(curMaxTokens, useJsonMode), timeoutMs);
    if (res.status === 400 && curMaxTokens > 4096 && /max_tokens/i.test(res.text)) {
        curMaxTokens = 4096;
        res = await postJson(endpoint, headers, makePayload(curMaxTokens, useJsonMode), timeoutMs);
    }
    if (res.status === 400 && /response_format|json_object/i.test(res.text)) {
        useJsonMode = false;
        res = await postJson(endpoint, headers, makePayload(curMaxTokens, useJsonMode), timeoutMs);
    }
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`大模型接口错误 (HTTP ${res.status}): ${res.text.slice(0, 260)}`);
    }
    const body = JSON.parse(res.text);
    const choice = body.choices?.[0];
    const content = choice?.message?.content || "";
    return {
        parsed: extractJsonObject(content),
        rawText: content,
        truncated: choice?.finish_reason === "length",
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

function buildConsolidationPrompts(items, { devices = [], existingModels = [], batchIndex = 1, totalBatches = 1, compact = false } = {}) {
    const systemPrompt = [
        "你是 QLEX 中心记忆中枢的权威记忆整理专家。",
        "你的目标是将来自多台设备（中心点与各接入点）的零散记忆整理成【唯一一份全端共享、高信噪比、无重复、无冲突的权威记忆】。",
        "你必须严格输出单个合法 JSON 对象，不要包含任何额外解释或 Markdown 代码块包裹，字符串内禁止出现未转义的换行或双引号。",
        "",
        "整理原则：",
        `1. 跨端合并去重 (merges，本批最多 ${compact ? 5 : 8} 组)：若多条记忆描述同一项目进展、同一问题排查、同一决策或重复会话碎片，合并为 1 条精炼权威记忆，并在 sourceIds 列出所有被合并的旧记忆 id（至少 2 个）。`,
        "2. 冲突演进替代 (supersedes)：若较新记忆推翻/更新了旧记忆，把旧 id 放入 supersededId，新 id 放入 winnerId，并写明简短 reason（<=25字）。",
        "3. 噪音淘汰 (prunes)：识别一次性闲聊、空壳提示、无长期复用价值的临时指令，放入 prunes（reason <=25字）。重要事实、偏好、项目产出与排错教训不要误删。",
        `4. 高层次提炼 (syntheses，本批最多 ${compact ? 1 : 2} 条)：仅在确有跨记忆综合价值时输出全局项目现状/用户长期偏好总结（给出唯一 factKey，如 center:project:<slug>）。`,
        "5. 输出保持精炼：l0 <= 120字，l1 <= 200字，l2 <= 320字；严格忠实输入事实，不得捏造。",
        "",
        "输出 JSON Schema：",
        "{",
        '  "summary": "本批整理的一句话总结（<=80字）",',
        '  "merges": [',
        "    {",
        '      "sourceIds": ["mem_xxx", "mem_yyy"],',
        '      "title": "合并后精炼标题（<=50字）",',
        '      "bank": "world|experience|opinion|observation",',
        '      "project": "项目名或空字符串",',
        '      "factKey": "可选稳定键",',
        '      "l0": "一句话核心摘要（<=120字）",',
        '      "l1": "结构化要点（<=200字）",',
        '      "l2": "整合后的精炼权威记忆（<=320字）",',
        '      "tags": ["标签1", "标签2"],',
        '      "confidence": 0.9',
        "    }",
        "  ],",
        '  "supersedes": [',
        '    { "supersededId": "mem_old", "winnerId": "mem_new", "reason": "新决策已替代旧方案" }',
        "  ],",
        '  "prunes": [',
        '    { "id": "mem_noise", "reason": "一次性临时操作" }',
        "  ],",
        '  "syntheses": [',
        "    {",
        '      "title": "跨端综合洞察标题",',
        '      "bank": "mental_model|observation|world|experience|opinion",',
        '      "project": "项目名或空字符串",',
        '      "factKey": "center:...",',
        '      "l0": "一句话摘要（<=120字）",',
        '      "l1": "结构化要点（<=200字）",',
        '      "l2": "精炼综合内容（<=320字）",',
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
        l1: String(it.l1 || "").slice(0, compact ? 180 : 280),
    }));

    const userPrompt = JSON.stringify({
        context: {
            now: new Date().toISOString(),
            batch: `${batchIndex}/${totalBatches}`,
            totalInputItems: compactItems.length,
            devices,
            existingMentalModels: existingModels.slice(0, 8).map(m => ({
                id: m.id,
                factKey: m.factKey || "",
                title: m.title,
                l0: m.l0,
            })),
        },
        memories: compactItems,
    });

    return { systemPrompt, userPrompt };
}

/**
 * Group memories by project before chunking into batches of <= batchSize
 * so cross-device duplicates for the same project always land in the same LLM batch.
 */
function buildConsolidationBatches(items, batchSize = 25) {
    if (items.length <= batchSize) return [items];
    const byProject = new Map();
    for (const it of items) {
        const key = (it.project || "").toLowerCase();
        if (!byProject.has(key)) byProject.set(key, []);
        byProject.get(key).push(it);
    }
    const groups = [...byProject.values()].sort((a, b) => b.length - a.length);
    const batches = [];
    let current = [];
    for (const group of groups) {
        if (group.length > batchSize) {
            if (current.length) {
                batches.push(current);
                current = [];
            }
            for (let i = 0; i < group.length; i += batchSize) {
                batches.push(group.slice(i, i + batchSize));
            }
            continue;
        }
        if (current.length + group.length > batchSize) {
            batches.push(current);
            current = [];
        }
        current.push(...group);
    }
    if (current.length) batches.push(current);
    return batches;
}

async function runSingleBatch(config, batchItems, ctx) {
    const runAttempt = async (subset, compact) => {
        const { systemPrompt, userPrompt } = buildConsolidationPrompts(subset, { ...ctx, compact });
        return callLlmJson(config, {
            systemPrompt,
            userPrompt,
            maxTokens: compact ? 4096 : 8192,
            timeoutMs: 110_000,
        });
    };

    try {
        return await runAttempt(batchItems, false);
    } catch (firstErr) {
        // Retry once in compact mode if JSON parsing failed (do not retry auth/network HTTP errors)
        const isJsonErr = /JSON|解析|截断/i.test(String(firstErr?.message || ""));
        if (!isJsonErr) throw firstErr;
        if (batchItems.length > 10) {
            const mid = Math.ceil(batchItems.length / 2);
            const [left, right] = await Promise.all([
                runAttempt(batchItems.slice(0, mid), true),
                runAttempt(batchItems.slice(mid), true),
            ]);
            const lp = left.parsed || {};
            const rp = right.parsed || {};
            return {
                parsed: {
                    summary: [lp.summary, rp.summary].filter(Boolean).join("；"),
                    merges: [...(Array.isArray(lp.merges) ? lp.merges : []), ...(Array.isArray(rp.merges) ? rp.merges : [])],
                    supersedes: [...(Array.isArray(lp.supersedes) ? lp.supersedes : []), ...(Array.isArray(rp.supersedes) ? rp.supersedes : [])],
                    prunes: [...(Array.isArray(lp.prunes) ? lp.prunes : []), ...(Array.isArray(rp.prunes) ? rp.prunes : [])],
                    syntheses: [...(Array.isArray(lp.syntheses) ? lp.syntheses : []), ...(Array.isArray(rp.syntheses) ? rp.syntheses : [])],
                },
                usage: {
                    inputTokens: (left.usage?.inputTokens || 0) + (right.usage?.inputTokens || 0),
                    outputTokens: (left.usage?.outputTokens || 0) + (right.usage?.outputTokens || 0),
                },
                latencyMs: (left.latencyMs || 0) + (right.latencyMs || 0),
                model: left.model || right.model || config?.model || "",
            };
        }
        return runAttempt(batchItems, true);
    }
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

    const batchSize = Math.max(10, Math.min(30, Number(ctx.batchSize) || 25));
    const batches = buildConsolidationBatches(items, batchSize);
    const summaries = [];
    const merges = [];
    const supersedes = [];
    const prunes = [];
    const syntheses = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let latencyMs = 0;
    let usedModel = config?.model || "";

    for (let i = 0; i < batches.length; i++) {
        const res = await runSingleBatch(config, batches[i], {
            ...ctx,
            batchIndex: i + 1,
            totalBatches: batches.length,
        });
        const raw = res.parsed && typeof res.parsed === "object" ? res.parsed : {};
        if (typeof raw.summary === "string" && raw.summary.trim()) {
            summaries.push(raw.summary.trim());
        }
        if (Array.isArray(raw.merges)) merges.push(...raw.merges);
        if (Array.isArray(raw.supersedes)) supersedes.push(...raw.supersedes);
        if (Array.isArray(raw.prunes)) prunes.push(...raw.prunes);
        if (Array.isArray(raw.syntheses)) syntheses.push(...raw.syntheses);
        inputTokens += res.usage?.inputTokens || 0;
        outputTokens += res.usage?.outputTokens || 0;
        latencyMs += res.latencyMs || 0;
        if (res.model) usedModel = res.model;
    }

    return {
        skipped: false,
        batches: batches.length,
        plan: {
            summary: (summaries.join("；") || "大模型已完成跨端记忆整理。").slice(0, 400),
            merges,
            supersedes,
            prunes,
            syntheses,
        },
        usage: { inputTokens, outputTokens },
        latencyMs,
        model: usedModel,
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
    extractJsonObject,
    buildConsolidationBatches,
    testMemoryLlmConnection,
    runLlmConsolidationPlan,
};
