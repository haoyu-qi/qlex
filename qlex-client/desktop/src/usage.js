"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { homedir } = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const exec = promisify(execFile);
const clients = ["antigravity", "antigravity-cli", "antigravity-extension", "codex", "claude", "hermes", "dsh"];
const sources = ["antigravity", "codex", "claude", "hermes", "dsh"];
const group = client => client.startsWith("antigravity") ? "antigravity" : client;
const number = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;

function directories(directory) {
    try {
        return fs.readdirSync(directory, { withFileTypes: true });
    } catch {
        return [];
    }
}

function engine(home, env, platform = process.platform, arch = process.arch) {
    const variant = platform === "win32" ? "win32-" + arch : platform + "-" + arch;
    const executable = platform === "win32" ? "tokscale.exe" : "tokscale";
    const resources = "app.asar.unpacked/node_modules/@tokscale/" + "cli-" + variant + "/bin/" + executable;
    const candidates = [
        env.QLEX_TOKSCALE_PATH,
        platform === "darwin" && path.join("/Applications/Token Monitor.app/Contents/Resources", resources),
        platform === "darwin" && path.join(home, "Applications/Token Monitor.app/Contents/Resources", resources),
        env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs/Token Monitor/resources", resources),
        path.join(home, ".local/bin", executable),
        "/opt/homebrew/bin/tokscale",
    ];
    return candidates.find(file => typeof file === "string" && path.isAbsolute(file) && fs.existsSync(file)) || executable;
}

function dshHome(home, env) {
    const candidates = [
        env.DSH_HOME,
        path.join(home, "Library/Application Support/@deepseek-ai/dsh-desktop/harness"),
        path.join(home, "Library/Application Support/dsh-desktop/harness"),
        env.APPDATA && path.join(env.APPDATA, "dsh-desktop/harness"),
        env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "dsh-desktop/harness"),
        path.join(home, ".dsh"),
        path.join(home, ".DSH"),
    ];
    return candidates.find(item => item && directories(path.join(item, "sessions")).some(entry => entry.isDirectory()));
}

function reportSummary(report) {
    const { entries, workspaces = [], sessions: activityRows = [] } = report;
    if (!Array.isArray(entries) || !Array.isArray(workspaces) || !Array.isArray(activityRows)) {
        throw new Error("Unexpected local report schema");
    }
    const workspaceByKey = new Map(workspaces.map(row => [row.workspaceKey, row]));
    const activity = new Map(activityRows.map(row => [row.client + ":" + row.sessionId, number(row.lastActiveMs)]));
    const totals = Object.fromEntries(sources.map(source => [source, { tokens: 0, sessions: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }]));
    const projectByPath = new Map();
    const sessions = new Map();
    for (const row of entries) {
        if (!clients.includes(row.client)) continue;
        const source = group(row.client);
        const key = row.client + ":" + row.sessionId;
        const info = workspaceByKey.get(row.workspaceKey);
        const workspace = typeof info?.path === "string" && path.isAbsolute(info.path) ? path.normalize(info.path) : "";
        const tokens = number(row.input) + number(row.output) + number(row.cacheRead) + number(row.cacheWrite);
        totals[source].tokens += tokens;
        for (const bucket of ["input", "output", "cacheRead", "cacheWrite"])
            totals[source][bucket] += number(row[bucket]);
        if (typeof row.sessionId === "string") {
            if (!sessions.has(key)) totals[source].sessions++;
            const previous = sessions.get(key);
            sessions.set(key, {
                id: row.sessionId, source, workspace: workspace || previous?.workspace || "",
                tokens: (previous?.tokens || 0) + tokens, lastActive: activity.get(key) || 0,
            });
        }
        if (!workspace) continue;
        const project = projectByPath.get(workspace) || {
            name: path.basename(workspace), directory: workspace, tokens: 0, lastActive: 0, sources: [],
        };
        project.tokens += tokens;
        project.lastActive = Math.max(project.lastActive, activity.get(key) || 0);
        if (!project.sources.includes(source)) project.sources.push(source);
        projectByPath.set(workspace, project);
    }
    for (const session of sessions.values()) {
        const project = projectByPath.get(session.workspace);
        if (project) project.sessions = (project.sessions || 0) + 1;
    }
    return {
        total: Object.values(totals).reduce((sum, item) => sum + item.tokens, 0),
        totals,
        projects: [...projectByPath.values()].sort((a, b) => b.lastActive - a.lastActive || b.tokens - a.tokens),
        sessions: [...sessions.values()].sort((a, b) => b.lastActive - a.lastActive),
    };
}

function recentRollouts(directory, depth = 4) {
    if (!depth) return [];
    return directories(directory).sort((a, b) => b.name.localeCompare(a.name)).slice(0, 12).flatMap(entry => {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) return recentRollouts(target, depth - 1);
        return entry.isFile() && /^rollout-.*\.jsonl$/.test(entry.name) ? [target] : [];
    }).slice(0, 12);
}

async function codexQuota(home, env) {
    const root = path.join(env.CODEX_HOME || path.join(home, ".codex"), "sessions");
    const results = await Promise.all(recentRollouts(root).map(async file => {
        let handle;
        try {
            handle = await fs.promises.open(file, "r");
            const { size } = await handle.stat();
            const length = Math.min(size, 512 * 1024);
            const buffer = Buffer.alloc(length);
            const { bytesRead } = await handle.read(buffer, 0, length, size - length);
            const lines = buffer.subarray(0, bytesRead).toString("utf8").split("\n").reverse();
            for (const line of lines) {
                if (!line.includes('"rate_limits"')) continue;
                try {
                    const record = JSON.parse(line);
                    const limits = record.payload?.rate_limits;
                    const time = Date.parse(record.timestamp);
                    const windows = [limits?.primary, limits?.secondary].filter(w =>
                        typeof w?.used_percent === "number" && w.used_percent >= 0 && w.used_percent <= 100);
                    if (time > 0 && windows.length && (!limits.limit_id || limits.limit_id === "codex")) {
                        return {
                            time,
                            windows: windows.map(w => ({
                                used: w.used_percent, minutes: number(w.window_minutes), resetsAt: number(w.resets_at) * 1000,
                            })),
                        };
                    }
                } catch { /* Ignore a partial line. */ }
            }
        } catch { /* A removed or unreadable rollout can be skipped. */ }
        finally { await handle?.close(); }
    }));
    return results.filter(Boolean).sort((a, b) => b.time - a.time)[0] || null;
}

function createUsageCollector({ home = homedir(), env = process.env, run = exec } = {}) {
    let state = { phase: "loading", today: null, week: null, history: {}, quotas: {}, time: 0 };
    let running;

    async function localReport(period, graph = false) {
        const bin = engine(home, env);
        const homeDsh = dshHome(home, env);
        const options = {
            cwd: home, env: { ...env, ...(homeDsh ? { DSH_HOME: homeDsh } : {}) },
            timeout: 45_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
        };
        const common = ["--offline", "--no-spinner", "-c", clients.join(","), "--home", home];
        const args = graph ? ["graph", ...common] :
            [...common, "--json", "--group-by", "client,workspace,session,model"];
        const { stdout } = await run(bin, [...args, ...period], options);
        return JSON.parse(stdout);
    }

    async function collect(period) {
        return reportSummary(await localReport(period));
    }

    async function dailyTotals(period) {
        try {
            const graph = await localReport(period, true);
            if (!Array.isArray(graph.contributions)) return null;
            return graph.contributions.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row?.date))
                .map(row => ({ date: row.date, tokens: number(row.totals?.tokens) }))
                .sort((a, b) => a.date.localeCompare(b.date));
        } catch {
            return null;
        }
    }

    async function history(days) {
        if (![30, 90].includes(days)) throw new Error("请选择有效的用量时间范围。");
        const since = new Date();
        since.setDate(since.getDate() - (days - 1));
        const date = [since.getFullYear(), String(since.getMonth() + 1).padStart(2, "0"),
            String(since.getDate()).padStart(2, "0")].join("-");
        const period = ["--since", date];
        const [report, daily] = await Promise.all([collect(period), dailyTotals(period)]);
        state = { ...state, history: { ...state.history, [days]: { ...report, daily } } };
        return state;
    }

    function refresh() {
        if (running) return running;
        running = (async () => {
            const results = await Promise.allSettled([
                collect(["--today"]),
                collect(["--week"]),
                codexQuota(home, env),
                dailyTotals(["--week"]),
            ]);
            const [today, week, codex, trend] = results;
            const daily = trend.status === "fulfilled" ? trend.value : null;
            const ok = today.status === "fulfilled" && week.status === "fulfilled";
            const hasMissingEngine = results.slice(0, 2).some(item => item.reason?.code === "ENOENT");
            state = { ...state,
                phase: ok ? "ready" : hasMissingEngine ? "missing-engine" : "partial",
                today: today.status === "fulfilled" ? today.value : state.today,
                week: week.status === "fulfilled" ? { ...week.value, daily } : state.week,
                quotas: { codex: codex.status === "fulfilled" ? codex.value : null },
                time: ok ? Date.now() : state.time,
            };
            return state;
        })().finally(() => { running = undefined; });
        return running;
    }
    return { refresh, history, snapshot: () => state };
}

exports.createUsageCollector = createUsageCollector;
exports.reportSummary = reportSummary;
