"use strict";

/**
 * QLEX Tailscale SDK & Auto-Discovery Engine
 *
 * Dual-mode architecture:
 *  - Mode A (System Tailscale): Auto-detects local Tailscale daemon via `tailscale status --json`.
 *  - Mode B (Embedded Go `tsnet` SDK Sidecar): Spawns bundled `qlex-tsnet` userspace netstack binary
 *    so machines WITHOUT system Tailscale can join a Tailnet & expose QLEX center (port 46271) with zero root/VPN drivers!
 *  - Auto-Discovery: Probes online Tailnet peers (`/qlex/v1/discover`) AND LAN UDP beacon (port 46272)
 *    to surface nearby & cross-NAT QLEX centers automatically.
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const https = require("node:https");
const dgram = require("node:dgram");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const DISCOVERY_UDP_PORT = 46272;
const CENTER_PORT = 46271;

function findSystemTailscaleBin() {
    const candidates = process.platform === "darwin"
        ? [
            "/usr/local/bin/tailscale",
            "/opt/homebrew/bin/tailscale",
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        ]
        : process.platform === "win32"
            ? ["C:\\Program Files\\Tailscale\\tailscale.exe", "tailscale.exe"]
            : ["/usr/bin/tailscale", "/usr/local/bin/tailscale"];
    return candidates.find(p => path.isAbsolute(p) && fs.existsSync(p)) || "tailscale";
}

function findEmbeddedTsnetBin() {
    const name = `qlex-tsnet-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
    const candidates = [
        path.join(__dirname, "../bin", name),
        path.join(__dirname.replace("app.asar", "app.asar.unpacked"), "../bin", name),
    ];
    return candidates.find(p => fs.existsSync(p)) || null;
}

function isTailscaleIp(host) {
    if (typeof host !== "string") return false;
    const m = host.match(/^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const second = Number(m[1]);
    return second >= 64 && second <= 127;
}

function isMagicDnsHost(host) {
    return typeof host === "string" && /^[a-z0-9][a-z0-9.-]*\.ts\.net\.?$/i.test(host);
}

function probeQlexCenter(host, port = CENTER_PORT, timeoutMs = 1300) {
    return new Promise((resolve) => {
        const started = Date.now();
        const req = https.request({
            host,
            port,
            path: "/qlex/v1/discover",
            method: "GET",
            rejectUnauthorized: false,
            agent: false,
            timeout: timeoutMs,
        }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                resolve(null);
                return;
            }
            const chunks = [];
            res.on("data", c => chunks.push(c));
            res.on("end", () => {
                try {
                    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                    if (data && data.app === "QLEX") {
                        resolve({ ...data, host, port, latencyMs: Date.now() - started });
                    } else {
                        resolve(null);
                    }
                } catch {
                    resolve(null);
                }
            });
        });
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.on("error", () => resolve(null));
        req.end();
    });
}

function createTailscaleManager({ dataDir, getCenterInfo, onChange } = {}) {
    const stateDir = path.join(dataDir || os.tmpdir(), "tsnet-state");
    const embeddedBin = findEmbeddedTsnetBin();

    let sidecar = null;
    let udpSocket = null;
    let beaconTimer = null;
    let lanPeers = new Map(); // deviceId -> peer record

    let state = {
        mode: "detecting", // "system" | "embedded" | "unavailable" | "stopped"
        backendState: "Unknown",
        online: false,
        embeddedAvailable: Boolean(embeddedBin),
        embeddedRunning: false,
        authURL: "",
        self: {
            hostName: os.hostname(),
            dnsName: "",
            ip: "",
            ips: [],
            os: process.platform,
        },
        tailnetPeers: [],
        discoveredCenters: [],
        lastScan: 0,
        error: null,
    };

    let lastEmitFp = "";
    function emitChange() {
        const fp = JSON.stringify({
            mode: state.mode,
            backendState: state.backendState,
            online: state.online,
            embeddedRunning: state.embeddedRunning,
            authURL: state.authURL,
            self: state.self,
            tailnetPeers: state.tailnetPeers,
            discoveredCenters: state.discoveredCenters,
            error: state.error,
        });
        if (fp === lastEmitFp) return;
        lastEmitFp = fp;
        onChange?.(structuredClone(state));
    }

    async function querySystemTailscale() {
        const bin = findSystemTailscaleBin();
        try {
            const { stdout } = await execFileAsync(bin, ["status", "--json"], { timeout: 3500, maxBuffer: 4 * 1024 * 1024 });
            const raw = JSON.parse(stdout);
            const ips = Array.isArray(raw.TailscaleIPs) ? raw.TailscaleIPs : [];
            const ipv4 = ips.find(ip => isTailscaleIp(ip)) || ips[0] || "";
            const dnsName = String(raw.Self?.DNSName || "").replace(/\.$/, "");
            const peers = Object.values(raw.Peer || {}).map(p => {
                const pIps = Array.isArray(p.TailscaleIPs) ? p.TailscaleIPs : [];
                const pIp4 = pIps.find(ip => isTailscaleIp(ip)) || pIps[0] || "";
                return {
                    id: String(p.ID || ""),
                    hostName: String(p.HostName || ""),
                    dnsName: String(p.DNSName || "").replace(/\.$/, ""),
                    ip: pIp4,
                    os: String(p.OS || ""),
                    online: Boolean(p.Online),
                    relay: String(p.Relay || ""),
                    curAddr: String(p.CurAddr || ""),
                    direct: Boolean(p.CurAddr),
                };
            }).sort((a, b) => Number(b.online) - Number(a.online) || a.hostName.localeCompare(b.hostName));

            return {
                available: true,
                backendState: String(raw.BackendState || "Unknown"),
                online: raw.BackendState === "Running" && Boolean(ipv4),
                authURL: String(raw.AuthURL || ""),
                self: {
                    hostName: String(raw.Self?.HostName || os.hostname()),
                    dnsName,
                    ip: ipv4,
                    ips,
                    os: String(raw.Self?.OS || process.platform),
                },
                peers,
            };
        } catch {
            return { available: false };
        }
    }

    function startEmbedded({ authKey = "", hostname = "" } = {}) {
        if (!embeddedBin) {
            state = { ...state, error: "当前安装包未包含此平台的 qlex-tsnet 内嵌 SDK 二进制。" };
            emitChange();
            return structuredClone(state);
        }
        if (sidecar) return structuredClone(state);

        const safeHost = (hostname || `qlex-${os.hostname()}`)
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 48) || "qlex-node";

        fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
        const env = { ...process.env };
        if (authKey) env.QLEX_TSNET_AUTHKEY = authKey;

        const child = spawn(embeddedBin, [
            "-hostname", safeHost,
            "-state-dir", stateDir,
            "-listen-port", String(CENTER_PORT),
            "-target", `127.0.0.1:${CENTER_PORT}`,
        ], { env, stdio: ["ignore", "pipe", "pipe"] });

        sidecar = child;
        state = {
            ...state,
            mode: "embedded",
            backendState: "Starting",
            embeddedRunning: true,
            error: null,
        };
        emitChange();

        let buf = "";
        child.stdout.on("data", chunk => {
            buf += chunk.toString("utf8");
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const line of lines) {
                if (!line.trim().startsWith("{")) continue;
                try {
                    const evt = JSON.parse(line);
                    const ips = Array.isArray(evt.ips) ? evt.ips : [];
                    const ipv4 = ips.find(ip => isTailscaleIp(ip)) || ips[0] || "";
                    state = {
                        ...state,
                        mode: "embedded",
                        backendState: evt.backendState || state.backendState,
                        online: Boolean(evt.online),
                        authURL: evt.authURL || "",
                        self: {
                            hostName: evt.hostName || safeHost,
                            dnsName: evt.dnsName || "",
                            ip: ipv4,
                            ips,
                            os: process.platform,
                        },
                        tailnetPeers: Array.isArray(evt.peers) ? evt.peers : state.tailnetPeers,
                        error: evt.error || null,
                    };
                    emitChange();
                } catch { /* ignore malformed status line */ }
            }
        });

        child.on("exit", () => {
            if (sidecar === child) {
                sidecar = null;
                state = {
                    ...state,
                    embeddedRunning: false,
                    online: false,
                    backendState: "Stopped",
                };
                emitChange();
            }
        });

        return structuredClone(state);
    }

    function stopEmbedded() {
        if (sidecar) {
            try { sidecar.kill("SIGTERM"); } catch { /* ignore */ }
            sidecar = null;
        }
        state = { ...state, embeddedRunning: false };
        emitChange();
        return structuredClone(state);
    }

    /**
     * Lightweight LAN UDP auto-discovery beacon (complements Tailscale discovery)
     */
    function startLanDiscovery() {
        if (udpSocket) return;
        try {
            const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
            sock.on("error", () => { /* ignore port conflict */ });
            sock.on("message", (msg, rinfo) => {
                try {
                    const data = JSON.parse(msg.toString("utf8"));
                    const selfInfo = getCenterInfo?.();
                    if (data?.app !== "QLEX" || data.mode !== "center") return;
                    if (selfInfo?.deviceId && data.deviceId === selfInfo.deviceId) return;
                    lanPeers.set(data.deviceId, {
                        deviceId: data.deviceId,
                        name: String(data.name || rinfo.address).slice(0, 80),
                        host: rinfo.address,
                        dnsName: "",
                        port: Number(data.port) || CENTER_PORT,
                        transport: "lan",
                        latencyMs: 1,
                        relay: "",
                        os: data.os || "",
                        version: data.version || "",
                        seenAt: Date.now(),
                    });
                } catch { /* ignore */ }
            });
            sock.bind(DISCOVERY_UDP_PORT, () => {
                try { sock.setBroadcast(true); } catch { /* ignore */ }
            });
            udpSocket = sock;

            beaconTimer = setInterval(() => {
                const info = getCenterInfo?.();
                if (!info || info.mode !== "center" || !info.online) return;
                const payload = Buffer.from(JSON.stringify({
                    app: "QLEX",
                    mode: "center",
                    deviceId: info.deviceId,
                    name: os.hostname(),
                    port: info.port || CENTER_PORT,
                    os: process.platform,
                    version: info.version || "",
                }));
                try {
                    sock.send(payload, 0, payload.length, DISCOVERY_UDP_PORT, "255.255.255.255");
                } catch { /* ignore */ }
            }, 8000);
            beaconTimer.unref();
        } catch { /* UDP unavailable */ }
    }

    async function refreshAndDiscover() {
        if (!state.embeddedRunning) {
            const sys = await querySystemTailscale();
            if (sys.available) {
                state = {
                    ...state,
                    mode: "system",
                    backendState: sys.backendState,
                    online: sys.online,
                    authURL: sys.authURL,
                    self: sys.self,
                    tailnetPeers: sys.peers,
                    error: null,
                };
            } else {
                state = {
                    ...state,
                    mode: embeddedBin ? "stopped" : "unavailable",
                    backendState: "Stopped",
                    online: false,
                    tailnetPeers: [],
                };
            }
        }

        // Probe online Tailnet peers for running QLEX centers (bounded concurrency)
        const onlinePeers = (state.tailnetPeers || []).filter(p => p.online && p.ip).slice(0, 16);
        const discovered = [];
        const selfInfo = getCenterInfo?.();

        const probes = await Promise.all(onlinePeers.map(async (peer) => {
            const found = await probeQlexCenter(peer.ip, CENTER_PORT, 1200);
            if (!found) return null;
            if (selfInfo?.deviceId && found.deviceId === selfInfo.deviceId) return null;
            return {
                deviceId: found.deviceId || peer.id,
                name: found.name || peer.hostName,
                host: peer.ip,
                dnsName: peer.dnsName,
                port: found.port || CENTER_PORT,
                transport: peer.direct ? "tailscale-direct" : "tailscale-relay",
                latencyMs: found.latencyMs,
                relay: peer.relay || "",
                os: peer.os || found.os || "",
                version: found.version || "",
            };
        }));

        for (const p of probes) if (p) discovered.push(p);

        // Merge fresh LAN peers (seen within 30s)
        const cutoff = Date.now() - 30_000;
        for (const [id, lp] of lanPeers.entries()) {
            if (lp.seenAt < cutoff) {
                lanPeers.delete(id);
                continue;
            }
            if (!discovered.some(d => d.deviceId === id)) discovered.push(lp);
        }

        state = {
            ...state,
            discoveredCenters: discovered,
            lastScan: Date.now(),
        };
        emitChange();
        return structuredClone(state);
    }

    function stop() {
        stopEmbedded();
        if (beaconTimer) { clearInterval(beaconTimer); beaconTimer = null; }
        if (udpSocket) {
            try { udpSocket.close(); } catch { /* ignore */ }
            udpSocket = null;
        }
    }

    return {
        startLanDiscovery,
        refreshAndDiscover,
        startEmbedded,
        stopEmbedded,
        stop,
        snapshot: () => structuredClone(state),
    };
}

module.exports = {
    createTailscaleManager,
    isTailscaleIp,
    isMagicDnsHost,
    findEmbeddedTsnetBin,
    findSystemTailscaleBin,
    probeQlexCenter,
};
