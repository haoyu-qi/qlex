"use strict";

/**
 * QLEX Version Download & Update Push Engine (Stable / Beta Dual-Channel)
 *
 * Features:
 *  - Checks GitHub Releases API (`haoyu-qi/qlex`) with ETag caching
 *  - Supports `beta` (includes Pre-releases) and `stable` channels
 *  - Parses `update-manifest.json` or falls back to Release assets (`.pkg`/`.zip` + `SHA256SUMS.txt`)
 *  - Streaming download with live progress callbacks + mandatory SHA-256 checksum verification
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const https = require("node:https");
const { createHash } = require("node:crypto");

const DEFAULT_REPO = "haoyu-qi/qlex";

function parseSemver(raw) {
    const clean = String(raw || "").trim().replace(/^v/i, "");
    const [core, pre = ""] = clean.split("-", 2);
    const nums = core.split(".").map(x => Number.parseInt(x, 10) || 0);
    return {
        major: nums[0] || 0,
        minor: nums[1] || 0,
        patch: nums[2] || 0,
        pre: pre ? pre.split(".").map(p => (/^\d+$/.test(p) ? Number(p) : p)) : [],
        raw: clean,
    };
}

function compareVersions(a, b) {
    const va = parseSemver(a);
    const vb = parseSemver(b);
    for (const k of ["major", "minor", "patch"]) {
        if (va[k] !== vb[k]) return va[k] - vb[k];
    }
    // Stable (no pre) > Pre-release
    if (!va.pre.length && vb.pre.length) return 1;
    if (va.pre.length && !vb.pre.length) return -1;
    const len = Math.max(va.pre.length, vb.pre.length);
    for (let i = 0; i < len; i++) {
        const pa = va.pre[i];
        const pb = vb.pre[i];
        if (pa === undefined) return -1;
        if (pb === undefined) return 1;
        if (pa === pb) continue;
        if (typeof pa === "number" && typeof pb === "number") return pa - pb;
        return String(pa).localeCompare(String(pb));
    }
    return 0;
}

function httpsGetBuffer(url, headers = {}, redirects = 5) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                "User-Agent": "QLEX-Updater/0.2.0",
                "Accept": "application/vnd.github+json",
                ...headers,
            },
            timeout: 15_000,
        }, (res) => {
            if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
                res.resume();
                resolve(httpsGetBuffer(res.headers.location, headers, redirects - 1));
                return;
            }
            const chunks = [];
            res.on("data", c => chunks.push(c));
            res.on("end", () => resolve({
                status: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks),
            }));
        });
        req.on("timeout", () => { req.destroy(new Error("请求超时")); });
        req.on("error", reject);
    });
}

function streamDownloadToFile(url, destFile, onProgress, redirects = 5) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: { "User-Agent": "QLEX-Updater/0.2.0" },
            timeout: 60_000,
        }, (res) => {
            if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
                res.resume();
                resolve(streamDownloadToFile(res.headers.location, destFile, onProgress, redirects - 1));
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`下载失败 (HTTP ${res.statusCode})`));
                return;
            }
            const total = Number(res.headers["content-length"] || 0);
            let downloaded = 0;
            fs.mkdirSync(path.dirname(destFile), { recursive: true });
            const tmp = `${destFile}.part`;
            const out = fs.createWriteStream(tmp);
            const hash = createHash("sha256");

            res.on("data", chunk => {
                downloaded += chunk.length;
                hash.update(chunk);
                onProgress?.(downloaded, total);
            });
            res.pipe(out);
            out.on("finish", () => {
                out.close(() => {
                    fs.renameSync(tmp, destFile);
                    resolve({ filePath: destFile, sha256: hash.digest("hex"), size: downloaded });
                });
            });
            const fail = (err) => {
                try { out.destroy(); } catch { /* ignore */ }
                fs.rmSync(tmp, { force: true });
                reject(err);
            };
            res.on("error", fail);
            out.on("error", fail);
        });
        req.on("timeout", () => req.destroy(new Error("下载超时")));
        req.on("error", reject);
    });
}

function parseChecksumsText(text) {
    const map = {};
    for (const line of String(text || "").split("\n")) {
        const m = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
        if (m) map[path.basename(m[2].trim())] = m[1].toLowerCase();
    }
    return map;
}

function extractAppVersionFromRelease(release) {
    const assets = Array.isArray(release.assets) ? release.assets : [];
    for (const a of assets) {
        const m = String(a.name || "").match(/^QLEX-([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.]+)?)-macOS/i);
        if (m) return m[1];
    }
    return String(release.tag_name || "").replace(/^v/i, "");
}

function createUpdater({ currentVersion, repo = DEFAULT_REPO, cacheDir, getChannel = () => "beta", onChange, onUpdateFound } = {}) {
    const downloadDir = cacheDir || path.join(os.homedir(), "Library", "Caches", "QLEX", "updates");
    let etag = "";
    let checking = null;
    let downloading = null;

    let state = {
        phase: "idle", // "idle" | "checking" | "available" | "up-to-date" | "downloading" | "verifying" | "ready" | "error"
        currentVersion: currentVersion || "0.2.0-beta.1",
        channel: getChannel(),
        repo,
        latest: null, // { version, tag, title, notes, publishedAt, prerelease, htmlUrl, assetName, assetUrl, assetSize, expectedSha256 }
        progress: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        downloadedFile: "",
        verifiedSha256: "",
        lastChecked: 0,
        error: null,
    };

    function emit() {
        onChange?.(structuredClone(state));
    }

    async function resolveReleaseCandidate(releases, channel) {
        const archTag = process.platform === "darwin" ? `macOS-${process.arch}` : `${process.platform}-${process.arch}`;
        const eligible = releases.filter(r => {
            if (!r || r.draft) return false;
            if (channel === "stable" && r.prerelease) return false;
            return Array.isArray(r.assets) && r.assets.some(a =>
                String(a.name || "").includes(archTag) || a.name === "update-manifest.json"
            );
        });
        if (!eligible.length) return null;
        const release = eligible[0];
        const assets = release.assets || [];

        // Prefer structured update-manifest.json if published
        const manifestAsset = assets.find(a => a.name === "update-manifest.json");
        if (manifestAsset?.browser_download_url) {
            try {
                const res = await httpsGetBuffer(manifestAsset.browser_download_url);
                if (res.status === 200) {
                    const manifest = JSON.parse(res.body.toString("utf8"));
                    const platKey = `${process.platform}-${process.arch}`;
                    const plat = manifest.assets?.[platKey];
                    if (plat && (plat.pkgUrl || plat.zipUrl)) {
                        const rawUrl = plat.pkgUrl || plat.zipUrl;
                        const fileName = path.basename(rawUrl);
                        // Always prefer the real GitHub Release asset browser_download_url matching this filename
                        // so a mismatched manifest tag can never cause HTTP 404.
                        const matchedAsset = assets.find(a => a.name === fileName)
                            || assets.find(a => a.name.includes(archTag) && a.name.endsWith(".pkg"))
                            || assets.find(a => a.name.includes(archTag) && a.name.endsWith(".zip"));
                        const url = matchedAsset?.browser_download_url || rawUrl;
                        const isZip = url.endsWith(".zip");
                        return {
                            version: manifest.version || extractAppVersionFromRelease(release),
                            tag: release.tag_name || manifest.tag,
                            title: release.name || `QLEX ${manifest.version}`,
                            notes: manifest.notes || release.body || "",
                            publishedAt: manifest.publishedAt || release.published_at,
                            prerelease: Boolean(release.prerelease || manifest.channel === "beta"),
                            htmlUrl: release.html_url,
                            assetName: matchedAsset?.name || fileName,
                            assetUrl: url,
                            assetSize: matchedAsset?.size || (isZip ? plat.zipSize : plat.size) || 0,
                            expectedSha256: ((isZip ? plat.zipSha256 : plat.sha256) || "").toLowerCase(),
                        };
                    }
                }
            } catch { /* fallback to release assets */ }
        }

        // Fallback: pick .pkg then .zip + SHA256SUMS.txt directly from GitHub Release
        const pkgAsset = assets.find(a => a.name.includes(archTag) && a.name.endsWith(".pkg"))
            || assets.find(a => a.name.includes(archTag) && a.name.endsWith(".zip"));
        if (!pkgAsset) return null;

        let expectedSha256 = "";
        const sumAsset = assets.find(a => a.name === "SHA256SUMS.txt");
        if (sumAsset?.browser_download_url) {
            try {
                const sumRes = await httpsGetBuffer(sumAsset.browser_download_url);
                if (sumRes.status === 200) {
                    const map = parseChecksumsText(sumRes.body.toString("utf8"));
                    expectedSha256 = map[pkgAsset.name] || "";
                }
            } catch { /* optional checksum fallback */ }
        }

        return {
            version: extractAppVersionFromRelease(release),
            tag: release.tag_name,
            title: release.name || release.tag_name,
            notes: release.body || "",
            publishedAt: release.published_at,
            prerelease: Boolean(release.prerelease),
            htmlUrl: release.html_url,
            assetName: pkgAsset.name,
            assetUrl: pkgAsset.browser_download_url,
            assetSize: pkgAsset.size || 0,
            expectedSha256,
        };
    }

    async function checkForUpdates({ force = false, mockReleases = null } = {}) {
        if (checking) return checking;
        checking = (async () => {
            const channel = getChannel();
            state = { ...state, phase: "checking", channel, error: null };
            emit();

            let releases;
            if (Array.isArray(mockReleases)) {
                releases = mockReleases;
            } else {
                const headers = (!force && etag) ? { "If-None-Match": etag } : {};
                const res = await httpsGetBuffer(`https://api.github.com/repos/${repo}/releases?per_page=10`, headers);
                if (res.status === 304 && state.lastChecked > 0) {
                    state = { ...state, phase: state.latest && compareVersions(state.latest.version, state.currentVersion) > 0 ? "available" : "up-to-date", lastChecked: Date.now() };
                    emit();
                    return structuredClone(state);
                }
                if (res.status !== 200) {
                    throw new Error(`检查更新失败 (HTTP ${res.status})`);
                }
                if (res.headers.etag) etag = res.headers.etag;
                releases = JSON.parse(res.body.toString("utf8"));
            }

            const candidate = await resolveReleaseCandidate(releases, channel);
            if (!candidate || compareVersions(candidate.version, state.currentVersion) <= 0) {
                state = {
                    ...state,
                    phase: "up-to-date",
                    latest: candidate,
                    lastChecked: Date.now(),
                    error: null,
                };
                emit();
                return structuredClone(state);
            }

            const prevTag = state.latest?.tag;
            state = {
                ...state,
                phase: "available",
                latest: candidate,
                lastChecked: Date.now(),
                error: null,
            };
            emit();
            if (prevTag !== candidate.tag) {
                onUpdateFound?.(candidate);
            }
            return structuredClone(state);
        })().catch(err => {
            state = { ...state, phase: "error", error: err?.message || "检查更新失败", lastChecked: Date.now() };
            emit();
            return structuredClone(state);
        }).finally(() => { checking = null; });
        return checking;
    }

    async function downloadUpdate() {
        if (downloading) return downloading;
        if (!state.latest?.assetUrl) throw new Error("当前没有可下载的新版本。");
        downloading = (async () => {
            const target = state.latest;
            const destFile = path.join(downloadDir, target.assetName);
            state = {
                ...state,
                phase: "downloading",
                progress: 0,
                downloadedBytes: 0,
                totalBytes: target.assetSize || 0,
                error: null,
            };
            emit();

            let lastEmit = 0;
            const result = await streamDownloadToFile(target.assetUrl, destFile, (done, total) => {
                const now = Date.now();
                if (now - lastEmit < 120 && done < total) return;
                lastEmit = now;
                const pct = total > 0 ? Math.min(99, Math.round((done / total) * 100)) : 0;
                state = { ...state, downloadedBytes: done, totalBytes: total || target.assetSize || 0, progress: pct };
                emit();
            });

            state = { ...state, phase: "verifying", progress: 100 };
            emit();

            if (target.expectedSha256 && result.sha256 !== target.expectedSha256) {
                fs.rmSync(destFile, { force: true });
                throw new Error(`SHA-256 校验失败：期望 ${target.expectedSha256.slice(0, 12)}，实际 ${result.sha256.slice(0, 12)}`);
            }

            state = {
                ...state,
                phase: "ready",
                progress: 100,
                downloadedBytes: result.size,
                totalBytes: result.size,
                downloadedFile: result.filePath,
                verifiedSha256: result.sha256,
                error: null,
            };
            emit();
            return structuredClone(state);
        })().catch(err => {
            state = { ...state, phase: "error", error: err?.message || "下载更新失败" };
            emit();
            return structuredClone(state);
        }).finally(() => { downloading = null; });
        return downloading;
    }

    return {
        checkForUpdates,
        downloadUpdate,
        snapshot: () => structuredClone(state),
    };
}

module.exports = {
    createUpdater,
    compareVersions,
    parseSemver,
    parseChecksumsText,
};
