"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DevicePairing = void 0;
const node_crypto_1 = require("node:crypto");
const node_https_1 = require("node:https");
const node_net_1 = require("node:net");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const {
    scanProjectFiles,
    diffFileManifests,
    packProjectFiles,
    unpackProjectFiles,
    applyProjectFiles,
    getProjectMirrorDir,
} = require("./project-sync");
const port = 46271;
const lifetime = 10 * 60 * 1000;
const deviceLimit = 50;
const secretPattern = /^[A-Za-z0-9_-]{43}$/;
const idPattern = /^[a-f0-9-]{36}$/i;
const secret = () => (0, node_crypto_1.randomBytes)(32).toString("base64url");
const digest = (value) => (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
const deviceName = () => (0, node_os_1.hostname)().slice(0, 100);
function makeCenter(id) {
    const forge = __importStar(require("node-forge"));
    const keys = (0, node_crypto_1.generateKeyPairSync)("rsa", {
        modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    const cert = forge.pki.createCertificate();
    cert.publicKey = forge.pki.publicKeyFromPem(keys.publicKey);
    cert.serialNumber = "01" + (0, node_crypto_1.randomBytes)(16).toString("hex");
    cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
    cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);
    const subject = [{ name: "commonName", value: `QLEX ${id}` }];
    cert.setSubject(subject);
    cert.setIssuer(subject);
    cert.setExtensions([
        { name: "basicConstraints", cA: false },
        { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
        { name: "extKeyUsage", serverAuth: true },
    ]);
    cert.sign(forge.pki.privateKeyFromPem(keys.privateKey), forge.md.sha256.create());
    return { cert: forge.pki.certificateToPem(cert), key: keys.privateKey, peers: [] };
}
function isTailscaleIPv4(ip) {
    const m = typeof ip === "string" && ip.match(/^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const oct = Number(m[1]);
    return oct >= 64 && oct <= 127;
}
function isValidHost(host) {
    if (typeof host !== "string" || !host || host.length > 253) return false;
    if ((0, node_net_1.isIPv4)(host)) return true;
    // Allow MagicDNS (*.ts.net) and standard RFC-1123 hostnames
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(host);
}
function addresses(extraHosts = []) {
    const localIps = Object.values((0, node_os_1.networkInterfaces)()).flatMap((entries) => (entries ?? []).filter((entry) => !entry.internal && entry.family === "IPv4").map((entry) => entry.address));
    const all = [...new Set([...extraHosts.filter(isValidHost), ...localIps])];
    // Prioritize Tailscale (100.x & *.ts.net) ahead of LAN addresses
    return all.sort((a, b) => {
        const score = h => (h.endsWith(".ts.net") ? 0 : isTailscaleIPv4(h) ? 1 : 2);
        return score(a) - score(b);
    });
}
function readInvite(code) {
    if (typeof code !== "string")
        throw new Error("请粘贴中心生成的配对邀请。");
    const trimmed = code.trim();
    if (!/^QLEX[12]\.[A-Za-z0-9_-]{1,4096}$/.test(trimmed))
        throw new Error("配对邀请格式无效。");
    let invite;
    try {
        invite = JSON.parse(Buffer.from(trimmed.slice(6), "base64url").toString("utf8"));
        if (!isValidHost(invite.host) || !Number.isInteger(invite.port) || invite.port < 1 ||
            invite.port > 65535 || !secretPattern.test(invite.token) || typeof invite.cert !== "string" ||
            !Number.isSafeInteger(invite.expiresAt))
            throw new Error();
        new node_crypto_1.X509Certificate(invite.cert);
    }
    catch {
        throw new Error("配对邀请格式无效。");
    }
    if (Date.now() >= invite.expiresAt)
        throw new Error("配对邀请已过期，请在中心重新生成。");
    return invite;
}
async function readBody(stream, maxBytes = 4096) {
    const chunks = [];
    let size = 0;
    for await (const chunk of stream) {
        size += chunk.length;
        if (size > maxBytes)
            throw new Error("Invalid body");
        chunks.push(chunk);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!result || typeof result !== "object" || Array.isArray(result))
        throw new Error("Invalid body");
    return result;
}
function reply(response, status, body) {
    response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
}
function callCenter(endpoint, route, id, payload) {
    const { invite, credential } = endpoint;
    const pin = new node_crypto_1.X509Certificate(invite.cert).fingerprint256;
    const body = JSON.stringify({
        id, credential,
        ...(route === "join" ? { token: invite.token, name: deviceName() } : {}),
        ...(route === "skills" && payload ? { skill: payload } : {}),
        ...(route === "memory" && payload ? { bundle: payload } : {}),
        ...(route === "projects" && payload
            ? (Array.isArray(payload)
                ? { projects: payload }
                : { projects: payload.projects || [], deleted: payload.deleted || [] })
            : {}),
        ...(route === "project-files" && payload ? { fileTransfer: payload } : {}),
    });
    return new Promise((resolve, reject) => {
        const req = (0, node_https_1.request)({
            host: invite.host, port: invite.port, path: `/qlex/v1/${route}`, method: "POST",
            agent: false, ca: invite.cert, allowPartialTrustChain: true, minVersion: "TLSv1.2",
            checkServerIdentity: (_host, cert) => cert.fingerprint256 === pin ? undefined : new Error("QLEX center certificate mismatch"),
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                if (res.statusCode === 403) {
                    if (route === "join" || route === "status" || route === "leave") {
                        resolve(undefined);
                    } else {
                        reject(new Error("中心端尚未批准此设备或同步凭证已失效，请在「互联」页检查连接状态。"));
                    }
                } else if (res.statusCode === 404) {
                    reject(new Error("中心端 QLEX 版本较旧，暂不支持该同步接口，请将中心端升级到最新版本。"));
                } else {
                    reject(new Error(`中心暂时无法处理同步请求 (HTTP ${res.statusCode})，请检查中心设置。`));
                }
                return;
            }
            if (route === "skills") {
                void readBody(res, 768 * 1024).then(resolve, reject);
                return;
            }
            if (route === "memory") {
                void readBody(res, 4 * 1024 * 1024).then(resolve, reject);
                return;
            }
            if (route === "projects") {
                void readBody(res, 4 * 1024 * 1024).then(resolve, reject);
                return;
            }
            if (route === "project-files") {
                void readBody(res, 14 * 1024 * 1024).then(resolve, reject);
                return;
            }
            void readBody(res).then((data) => {
                if (typeof data.name !== "string" || data.name.length > 100 ||
                    !["pending", "connected", "rejected"].includes(String(data.status)))
                    throw new Error();
                resolve({ name: data.name, status: data.status });
            }).catch(() => reject(new Error("中心返回的配对状态无效。")));
        });
        const timeoutMs = route === "project-files" ? 60_000 : route === "memory" ? 12_000 : route === "projects" ? 15_000 : 4500;
        const timer = setTimeout(() => req.destroy(new Error("QLEX center timeout")), timeoutMs);
        req.once("error", () => reject(new Error("无法连接或验证中心。请检查中心是否在线、Tailscale 连接和防火墙设置。")));
        req.once("close", () => clearTimeout(timer));
        req.end(body);
    });
}
const peerOnlineWindow = 35_000;

class DevicePairing {
    store;
    listenPort;
    server;
    activeInvite;
    activeInviteCode;
    endpointOnline = false;
    peerSeenAt = new Map();
    refreshing;
    starting = false;
    startError;
    lastMemorySync = null;
    lastProjectSync = null;
    constructor(store, listenPort = port, skillSync, getExtraHosts = () => [], memoryArchive = null, onChange = null) {
        this.store = store;
        this.listenPort = listenPort;
        this.skillSync = skillSync;
        this.getExtraHosts = getExtraHosts;
        this.memoryArchive = memoryArchive;
        this.onChange = typeof onChange === "function" ? onChange : null;
    }
    get config() {
        return this.store.snapshot().pairing ?? { mode: "local" };
    }
    view() {
        const config = this.config;
        if (this.activeInvite && Date.now() >= this.activeInvite.expiresAt) {
            this.activeInvite = undefined;
            this.activeInviteCode = undefined;
        }
        const hostList = config.mode === "center" ? addresses(this.getExtraHosts?.() || []) : [];
        return {
            mode: config.mode,
            online: config.mode === "center" ? Boolean(this.server?.listening) : this.endpointOnline,
            error: this.startError,
            addresses: hostList,
            addressEntries: hostList.map(h => ({
                host: h,
                kind: (h.endsWith(".ts.net") || isTailscaleIPv4(h)) ? "tailscale" : "lan",
                label: h.endsWith(".ts.net") ? `Tailscale · ${h}` : isTailscaleIPv4(h) ? `Tailscale · ${h}` : `局域网 · ${h}`,
            })),
            port: this.serverPort(),
            activeInvite: config.mode === "center" && this.activeInvite && this.activeInviteCode ? {
                code: this.activeInviteCode,
                host: this.activeInvite.host,
                port: this.activeInvite.port,
                expiresAt: this.activeInvite.expiresAt,
                shortToken: this.activeInvite.token.slice(0, 8),
            } : null,
            peers: config.mode === "center" ? config.center?.peers.filter(({ status }) => status !== "rejected")
                .map(({ id, name, status, credentialHash }) => ({ id, name, status,
                    online: status === "connected" && Boolean(this.server?.listening) &&
                        Date.now() - (this.peerSeenAt.get(id) ?? -Infinity) < peerOnlineWindow,
                    check: credentialHash.slice(0, 6).toUpperCase() })) ?? [] : [],
            endpoint: config.endpoint && {
                name: config.endpoint.name, status: config.endpoint.status,
                address: `${config.endpoint.invite.host}:${config.endpoint.invite.port}`,
                check: digest(config.endpoint.credential).slice(0, 6).toUpperCase(),
            },
            syncMeta: {
                lastMemorySync: this.lastMemorySync,
                lastProjectSync: this.lastProjectSync,
                lastProjectsSync: this.lastProjectSync,
            },
        };
    }
    async start() {
        if (this.starting || this.server?.listening)
            return;
        this.starting = true;
        try {
            const config = this.config;
            if (config.mode === "endpoint")
                throw new Error("请先退出当前中心，再设为中心。");
            const center = config.center ?? makeCenter(this.store.snapshot().deviceId);
            const server = (0, node_https_1.createServer)({
                key: center.key, cert: center.cert, minVersion: "TLSv1.2", requestTimeout: 30_000,
                headersTimeout: 10_000, keepAliveTimeout: 2000, maxHeaderSize: 4096,
            }, (req, res) => { void this.handle(req, res); });
            server.maxConnections = 32;
            server.setTimeout(32_000, (socket) => socket.destroy());
            await new Promise((resolve, reject) => {
                server.once("error", reject);
                server.listen(this.listenPort, "0.0.0.0", () => {
                    server.removeListener("error", reject);
                    resolve();
                });
            }).catch(() => { throw new Error(`无法启动中心。请检查 TCP ${this.listenPort} 端口是否已被占用。`); });
            try {
                this.store.setPairing({ mode: "center", center });
            }
            catch (error) {
                server.close();
                throw error;
            }
            server.on("error", () => { this.startError = "中心服务异常，请重新启动中心。"; });
            this.server = server;
            this.endpointOnline = false;
            this.startError = undefined;
        }
        catch (error) {
            this.startError = error.message;
            throw error;
        }
        finally {
            this.starting = false;
        }
    }
    stop() {
        this.server?.close();
        this.server?.closeAllConnections();
        this.server = undefined;
        this.activeInvite = undefined;
        this.activeInviteCode = undefined;
        this.peerSeenAt.clear();
    }
    async useLocal() {
        const config = this.config;
        this.store.setPairing({ mode: "local", center: config.center });
        this.stop();
        this.endpointOnline = false;
        this.startError = undefined;
        if (config.endpoint && config.endpoint.status !== "rejected") {
            try {
                await callCenter(config.endpoint, "leave", this.store.snapshot().deviceId);
            }
            catch { /* Local exit still works when the center is unreachable. */ }
        }
    }
    serverPort() {
        const address = this.server?.address();
        return address && typeof address === "object" ? address.port : this.listenPort;
    }
    createInvite(host) {
        const allowed = addresses(this.getExtraHosts?.() || []);
        const selectedHost = (typeof host === "string" && allowed.includes(host)) ? host : allowed[0];
        if (!this.server?.listening || !selectedHost) {
            throw new Error("请先启动中心，并选择本机可用的网络地址。");
        }
        const center = this.config.center;
        this.activeInvite = { host: selectedHost, port: this.serverPort(), cert: center.cert, token: secret(), expiresAt: Date.now() + lifetime };
        this.activeInviteCode = "QLEX1." + Buffer.from(JSON.stringify(this.activeInvite)).toString("base64url");
        return this.activeInviteCode;
    }
    async join(code) {
        const config = this.config;
        if (config.mode === "center")
            throw new Error("请先停止本机中心，再加入其他中心。");
        const invite = readInvite(code);
        if (invite.cert === config.center?.cert)
            throw new Error("不能加入本机创建的中心。");
        if (config.mode === "endpoint")
            throw new Error("请先退出当前中心，再加入其他中心。");
        const previous = config.attempt;
        const keepCredential = previous?.invite.token === invite.token &&
            previous.invite.host === invite.host && previous.invite.port === invite.port && previous.invite.cert === invite.cert;
        const endpoint = {
            invite, credential: keepCredential ? previous.credential : secret(), status: "pending",
        };
        this.store.setPairing({ ...config, attempt: endpoint });
        const result = await callCenter(endpoint, "join", this.store.snapshot().deviceId);
        if (!result)
            throw new Error("邀请已被使用、已过期或被中心拒绝，请生成新邀请。");
        this.store.setPairing({
            mode: "endpoint", center: config.center, endpoint: { ...endpoint, invite: { ...invite, token: "" }, ...result },
        });
        this.startError = undefined;
        this.endpointOnline = true;
    }
    refresh() {
        this.refreshing ??= this.refreshEndpoint().finally(() => { this.refreshing = undefined; });
        return this.refreshing;
    }
    async refreshEndpoint() {
        const config = this.config;
        const endpoint = config.endpoint;
        if (config.mode !== "endpoint" || !endpoint || endpoint.status === "rejected")
            return;
        let result;
        let reached = false;
        try {
            result = await callCenter(endpoint, "status", this.store.snapshot().deviceId);
            reached = true;
        }
        catch { /* Retain membership while the center is unreachable. */ }
        const current = this.config;
        if (current.endpoint?.credential !== endpoint.credential)
            return;
        this.endpointOnline = reached && Boolean(result);
        if (!reached)
            return;
        const next = result ?? { name: endpoint.name, status: "rejected" };
        if (next.status !== endpoint.status || next.name !== endpoint.name) {
            this.store.setPairing({ ...current, endpoint: { ...endpoint, ...next } });
        }
        if (next.status === "rejected")
            this.endpointOnline = false;
    }
    requestSkills(selection) {
        const { mode, endpoint } = this.config;
        const local = this.store.snapshot();
        if (!local.skillSyncEnabled || mode !== "endpoint" || endpoint?.status !== "connected") return;
        return callCenter(endpoint, "skills", local.deviceId, selection);
    }
    async syncMemory() {
        const { mode, endpoint } = this.config;
        const local = this.store.snapshot();
        if (mode !== "endpoint" || endpoint?.status !== "connected" || !this.memoryArchive) return null;
        const localBundle = this.memoryArchive.exportSyncBundle({ deviceId: local.deviceId, deviceName: deviceName(), canonical: false });
        const response = await callCenter(endpoint, "memory", local.deviceId, localBundle);
        if (!response?.bundle) return null;
        const peerLabel = endpoint.name || endpoint.invite.host;
        const mergedLocal = this.memoryArchive.mergeSyncBundle(response.bundle, { isCenter: false, peerName: peerLabel });
        this.lastMemorySync = {
            time: Date.now(),
            peer: peerLabel,
            centerRevision: Number(response.bundle?.consolidation?.revision || 0),
            centerConsolidatedAt: Number(response.bundle?.consolidation?.lastConsolidatedAt || 0),
            pulledAdded: mergedLocal.itemsAdded,
            pulledUpdated: mergedLocal.itemsUpdated,
            tombstonesApplied: mergedLocal.tombstonesApplied || 0,
            pushedAdded: response.merged?.itemsAdded || 0,
            pushedUpdated: response.merged?.itemsUpdated || 0,
        };
        return this.lastMemorySync;
    }
    async syncProjects() {
        const { mode, endpoint } = this.config;
        const local = this.store.snapshot();
        this.store.refreshLocalProjectsMetadata(deviceName());
        if (mode === "center") {
            const snap = this.store.snapshot();
            const peers = this.view().peers || [];
            const onlinePeers = peers.filter(p => p.online).length;
            this.lastProjectSync = {
                time: Date.now(),
                role: "center",
                peer: `${onlinePeers}/${peers.filter(p => p.status === "connected").length} 台接入点`,
                added: 0,
                updated: 0,
                removed: 0,
                contextApplied: 0,
                remotePending: (snap.remoteProjects || []).length,
                totalShared: (snap.projects || []).length + (snap.remoteProjects || []).length,
                onlinePeers,
                error: "",
            };
            this.onChange?.("projects");
            return this.lastProjectSync;
        }
        if (mode !== "endpoint") {
            const snap = this.store.snapshot();
            this.lastProjectSync = {
                time: Date.now(),
                role: "local",
                peer: "仅本机",
                added: 0,
                updated: 0,
                removed: 0,
                contextApplied: 0,
                remotePending: (snap.remoteProjects || []).length,
                totalShared: (snap.projects || []).length,
                error: "",
            };
            return this.lastProjectSync;
        }
        if (endpoint?.status !== "connected") {
            const err = new Error(endpoint?.status === "pending" ? "等待中心端批准配对后即可同步项目。" : "接入点尚未连接到中心。");
            this.lastProjectSync = {
                time: Date.now(),
                role: "endpoint",
                peer: endpoint?.name || endpoint?.invite?.host || "中心节点",
                error: err.message,
            };
            this.onChange?.("projects");
            throw err;
        }
        try {
            const dataDir = (0, node_path_1.dirname)(this.store.file);
            const exported = this.store.exportSharedProjects(deviceName(), { includeContext: true, includeManifest: true, dataDir });
            const response = await callCenter(endpoint, "projects", local.deviceId, exported);
            if (!Array.isArray(response?.projects)) {
                throw new Error("中心端返回的项目同步数据格式无效。");
            }
            const snapBefore = this.store.snapshot();
            const autoBindDir = snapBefore.autoSaveSyncedProjects !== false ? snapBefore.projectSyncDir : "";
            const merged = this.store.mergeSharedProjects(
                { projects: response.projects, deleted: response.deleted || [] },
                { peerName: endpoint.name || endpoint.invite.host, applyContext: true, autoBindDir, dataDir }
            );

            // Real Bidirectional Workspace File Sync (delta push/pull for every bound project!)
            let filesPushed = 0;
            let filesPulled = 0;
            const remoteBySync = new Map(response.projects.map(p => [p.syncId, p]));
            const boundProjects = this.store.snapshot().projects || [];
            for (const lp of boundProjects) {
                if (lp.shared === false) continue;
                const localScanned = scanProjectFiles(lp.directory);
                const rp = remoteBySync.get(lp.syncId);
                const remoteManifest = Array.isArray(rp?.fileManifest) ? rp.fileManifest : [];
                const { toPull, toPush } = diffFileManifests(localScanned.files, remoteManifest);

                // Push local missing or newer files in safe batches
                for (let idx = 0; idx < toPush.length; ) {
                    const slice = toPush.slice(idx, idx + 80);
                    const packed = packProjectFiles(lp.directory, slice);
                    idx += Math.max(1, packed.count || slice.length);
                    if (!packed.count) continue;
                    try {
                        const pushRes = await callCenter(endpoint, "project-files", local.deviceId, {
                            action: "push",
                            syncId: lp.syncId,
                            gzipBase64: packed.gzipBase64,
                        });
                        filesPushed += Number(pushRes?.written || packed.count || 0);
                    } catch {
                        // Tolerate older center without /project-files while preserving metadata sync
                        break;
                    }
                }

                // Pull remote missing or newer files in safe batches (advance by actual returned count!)
                for (let idx = 0; idx < toPull.length; ) {
                    const slice = toPull.slice(idx, idx + 80);
                    try {
                        const pullRes = await callCenter(endpoint, "project-files", local.deviceId, {
                            action: "pull",
                            syncId: lp.syncId,
                            paths: slice,
                        });
                        const unpacked = unpackProjectFiles(pullRes?.gzipBase64 || "");
                        if (unpacked.length) {
                            const applied = applyProjectFiles(lp.directory, unpacked, lp.syncId);
                            filesPulled += applied.written;
                        }
                        const advanced = Number(pullRes?.count || unpacked.length || 0);
                        idx += advanced > 0 ? advanced : slice.length;
                    } catch {
                        break;
                    }
                }
            }

            if (filesPulled > 0 || filesPushed > 0) {
                this.store.refreshLocalProjectsMetadata(deviceName());
            }

            this.endpointOnline = true;
            this.lastProjectSync = {
                time: Date.now(),
                role: "endpoint",
                peer: endpoint.name || endpoint.invite.host,
                added: merged.added,
                updated: merged.updated,
                removed: merged.removed,
                contextApplied: merged.contextApplied,
                filesPushed,
                filesPulled,
                pushedAdded: response.merged?.added || 0,
                pushedUpdated: response.merged?.updated || 0,
                pushedRemoved: response.merged?.removed || 0,
                remotePending: merged.remotePending,
                totalShared: merged.totalShared,
                error: "",
            };
            this.onChange?.("projects");
            return this.lastProjectSync;
        } catch (err) {
            this.lastProjectSync = {
                time: Date.now(),
                role: "endpoint",
                peer: endpoint.name || endpoint.invite.host,
                error: err?.message || "跨端项目同步失败",
            };
            this.onChange?.("projects");
            throw err;
        }
    }
    decide(id, approve) {
        const config = this.config;
        const center = config.center;
        if (config.mode !== "center" || !center || typeof id !== "string")
            throw new Error("中心点不可用。");
        const peer = center.peers.find((entry) => entry.id === id);
        if (!peer || peer.status === "rejected" || (approve && peer.status !== "pending")) {
            throw new Error("该设备状态已变化，请刷新后重试。");
        }
        const peers = center.peers.filter((entry) => entry.id !== id);
        if (approve)
            peers.push({ ...peer, status: "connected" });
        this.store.setPairing({ ...config, center: { ...center, peers } });
        this.peerSeenAt.delete(id);
    }
    async handle(req, res) {
        try {
            if (req.method === "GET" && req.url === "/qlex/v1/discover") {
                const config = this.config;
                if (config.mode !== "center") {
                    reply(res, 404, {});
                    return;
                }
                reply(res, 200, {
                    app: "QLEX",
                    mode: "center",
                    deviceId: this.store.snapshot().deviceId,
                    name: deviceName(),
                    port: this.serverPort(),
                    os: process.platform,
                });
                return;
            }
            const join = req.url === "/qlex/v1/join";
            const leave = req.url === "/qlex/v1/leave";
            const skills = req.url === "/qlex/v1/skills";
            const memory = req.url === "/qlex/v1/memory";
            const projects = req.url === "/qlex/v1/projects";
            const projectFiles = req.url === "/qlex/v1/project-files";
            if (req.method !== "POST" || (!join && !leave && !skills && !memory && !projects && !projectFiles && req.url !== "/qlex/v1/status")) {
                reply(res, 404, {});
                return;
            }
            const maxBody = projectFiles ? 48 * 1024 * 1024 : memory ? 4 * 1024 * 1024 : projects ? 6 * 1024 * 1024 : 4096;
            const { id, credential, token, name, skill, bundle, projects: incomingProjects, deleted: incomingDeleted, fileTransfer } = await readBody(req, maxBody);
            if (typeof id !== "string" || !idPattern.test(id) || typeof credential !== "string" || !secretPattern.test(credential)) {
                reply(res, 400, {});
                return;
            }
            const config = this.config;
            const center = config.center;
            if (config.mode !== "center" || !center || id === this.store.snapshot().deviceId) {
                reply(res, 403, {});
                return;
            }
            const credentialHash = digest(credential);
            const existing = center.peers.find((entry) => entry.id === id);
            if (memory) {
                if (existing?.status !== "connected" || existing.credentialHash !== credentialHash || !this.memoryArchive) {
                    reply(res, 403, {});
                    return;
                }
                this.peerSeenAt.set(id, Date.now());
                const merged = this.memoryArchive.mergeSyncBundle(bundle, { isCenter: true, peerName: existing.name });
                const centerBundle = this.memoryArchive.exportSyncBundle({
                    deviceId: this.store.snapshot().deviceId,
                    deviceName: deviceName(),
                    canonical: true,
                });
                this.lastMemorySync = {
                    time: Date.now(),
                    peer: existing.name,
                    centerRevision: Number(centerBundle?.consolidation?.revision || 0),
                    pushedAdded: merged.itemsAdded,
                    pushedUpdated: merged.itemsUpdated,
                    pulledAdded: 0,
                    pulledUpdated: 0,
                };
                this.onChange?.("memory");
                reply(res, 200, { ok: true, merged, bundle: centerBundle });
                return;
            }
            if (projects) {
                if (existing?.status !== "connected" || existing.credentialHash !== credentialHash) {
                    reply(res, 403, {});
                    return;
                }
                this.peerSeenAt.set(id, Date.now());
                const dataDir = (0, node_path_1.dirname)(this.store.file);
                const centerSnap = this.store.snapshot();
                const autoBindDir = centerSnap.autoSaveSyncedProjects !== false ? centerSnap.projectSyncDir : "";
                const merged = this.store.mergeSharedProjects(
                    { projects: incomingProjects || [], deleted: incomingDeleted || [] },
                    { peerName: existing.name, applyContext: true, autoBindDir, dataDir }
                );
                const exported = this.store.exportSharedProjects(deviceName(), { includeContext: true, includeManifest: true, dataDir });
                this.lastProjectSync = {
                    time: Date.now(),
                    role: "center",
                    peer: existing.name,
                    added: merged.added,
                    updated: merged.updated,
                    removed: merged.removed,
                    contextApplied: merged.contextApplied,
                    remotePending: merged.remotePending,
                    totalShared: exported.projects.length,
                    error: "",
                };
                this.onChange?.("projects");
                reply(res, 200, { ok: true, merged, projects: exported.projects, deleted: exported.deleted });
                return;
            }
            if (projectFiles) {
                if (existing?.status !== "connected" || existing.credentialHash !== credentialHash) {
                    reply(res, 403, {});
                    return;
                }
                this.peerSeenAt.set(id, Date.now());
                const syncId = typeof fileTransfer?.syncId === "string" ? fileTransfer.syncId.trim() : "";
                if (!syncId) {
                    reply(res, 400, {});
                    return;
                }
                const dataDir = (0, node_path_1.dirname)(this.store.file);
                const bound = (this.store.snapshot().projects || []).find(p => p.syncId === syncId);
                const targetDir = bound ? bound.directory : getProjectMirrorDir(dataDir, syncId);

                if (fileTransfer.action === "pull") {
                    const paths = Array.isArray(fileTransfer.paths) ? fileTransfer.paths.slice(0, 100) : [];
                    const packed = packProjectFiles(targetDir, paths);
                    reply(res, 200, { ok: true, syncId, ...packed });
                    return;
                }
                if (fileTransfer.action === "push") {
                    const unpacked = unpackProjectFiles(fileTransfer.gzipBase64 || "");
                    const applied = applyProjectFiles(targetDir, unpacked, syncId);
                    if (bound) {
                        this.store.refreshLocalProjectsMetadata(deviceName());
                    } else {
                        // Update remoteProjects mirror fileCount & totalBytes so Center UI shows real file count immediately
                        const scanned = scanProjectFiles(targetDir);
                        const cur = this.store.snapshot();
                        const nextRemotes = (cur.remoteProjects || []).map(r =>
                            r.syncId === syncId ? { ...r, fileCount: scanned.fileCount, totalBytes: scanned.totalBytes } : r
                        );
                        this.store.update({ remoteProjects: nextRemotes });
                    }
                    this.lastProjectSync = {
                        ...(this.lastProjectSync || {}),
                        time: Date.now(),
                        role: "center",
                        peer: existing.name,
                        filesPulled: (this.lastProjectSync?.filesPulled || 0) + applied.written,
                    };
                    this.onChange?.("projects");
                    reply(res, 200, { ok: true, syncId, ...applied });
                    return;
                }
                reply(res, 400, {});
                return;
            }
            if (skills) {
                if (existing?.status !== "connected" || existing.credentialHash !== credentialHash ||
                    !this.store.snapshot().skillSyncEnabled || !this.skillSync) {
                    reply(res, 403, {});
                    return;
                }
                if (skill === undefined) {
                    reply(res, 200, { items: this.skillSync.catalog() });
                } else {
                    reply(res, 200, { package: this.skillSync.read(skill?.namespace, skill?.name) });
                }
                return;
            }
            if (existing && existing.credentialHash === credentialHash) {
                if (leave) {
                    this.store.setPairing({ ...config, center: { ...center, peers: center.peers.filter((entry) => entry.id !== id) } });
                    this.peerSeenAt.delete(id);
                } else if (!join && existing.status === "connected") {
                    this.peerSeenAt.set(id, Date.now());
                }
                reply(res, 200, { name: deviceName(), status: existing.status });
                return;
            }
            const invite = this.activeInvite;
            if (!join || !invite || typeof token !== "string" || Date.now() >= invite.expiresAt ||
                digest(token) !== digest(invite.token) || typeof name !== "string" || !name.trim() || name.length > 100) {
                reply(res, 403, {});
                return;
            }
            if (existing?.status === "connected" || (!existing && center.peers.length >= deviceLimit)) {
                reply(res, 409, {});
                return;
            }
            const peer = { id, name: name.trim(), credentialHash, status: "pending" };
            const peers = [...center.peers.filter((entry) => entry.id !== id), peer];
            this.store.setPairing({ ...config, center: { ...center, peers } });
            this.activeInvite = undefined;
            this.activeInviteCode = undefined;
            this.onChange?.("peers");
            reply(res, 200, { name: deviceName(), status: peer.status });
        }
        catch {
            if (!res.destroyed)
                reply(res, 400, {});
        }
    }
}
exports.DevicePairing = DevicePairing;
exports.isValidHost = isValidHost;
exports.isTailscaleIPv4 = isTailscaleIPv4;
exports.addresses = addresses;
