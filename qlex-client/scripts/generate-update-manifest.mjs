#!/usr/bin/env node
/**
 * Generate update-manifest.json & SHA256SUMS.txt for QLEX Beta/Stable Update Push Channel
 * Supports macOS arm64 (.pkg/.zip) AND Windows x64 (Setup.exe/Portable.zip) simultaneously.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
        flags[args[i].slice(2)] = args[i + 1];
        i++;
    }
}

const version = flags.version || JSON.parse(fs.readFileSync(path.resolve("qlex-client/package.json"), "utf8")).version;
const tag = flags.tag || `v${version}`;
const repo = flags.repo || "haoyu-qi/qlex";
const installersDir = path.resolve(flags.dir || "installers");
const channel = flags.channel || (/-beta|-rc|-alpha/i.test(version) ? "beta" : "stable");
const notes = flags.notes || `QLEX ${version} (${channel})`;

function sha256(file) {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function statIfExists(fileName) {
    const full = path.join(installersDir, fileName);
    if (!fs.existsSync(full)) return null;
    return { name: fileName, path: full, sha256: sha256(full), size: fs.statSync(full).size };
}

const macPkg = statIfExists(`QLEX-${version}-macOS-arm64.pkg`);
const macZip = statIfExists(`QLEX-${version}-macOS-arm64.zip`);
const winExe = statIfExists(`QLEX-${version}-Windows-x64-Setup.exe`);
const winZip = statIfExists(`QLEX-${version}-Windows-x64-Portable.zip`);

const checksumLines = [];
const assets = {};

if (macPkg || macZip) {
    const entry = {};
    if (macPkg) {
        entry.pkgUrl = `https://github.com/${repo}/releases/download/${tag}/${macPkg.name}`;
        entry.sha256 = macPkg.sha256;
        entry.size = macPkg.size;
        checksumLines.push(`${macPkg.sha256}  ${macPkg.name}`);
    }
    if (macZip) {
        entry.zipUrl = `https://github.com/${repo}/releases/download/${tag}/${macZip.name}`;
        entry.zipSha256 = macZip.sha256;
        entry.zipSize = macZip.size;
        checksumLines.push(`${macZip.sha256}  ${macZip.name}`);
    }
    assets["darwin-arm64"] = entry;
}

if (winExe || winZip) {
    const entry = {};
    if (winExe) {
        entry.exeUrl = `https://github.com/${repo}/releases/download/${tag}/${winExe.name}`;
        entry.sha256 = winExe.sha256;
        entry.size = winExe.size;
        checksumLines.push(`${winExe.sha256}  ${winExe.name}`);
    }
    if (winZip) {
        entry.zipUrl = `https://github.com/${repo}/releases/download/${tag}/${winZip.name}`;
        entry.zipSha256 = winZip.sha256;
        entry.zipSize = winZip.size;
        checksumLines.push(`${winZip.sha256}  ${winZip.name}`);
    }
    assets["win32-x64"] = entry;
}

fs.writeFileSync(path.join(installersDir, "SHA256SUMS.txt"), checksumLines.join("\n") + "\n", "utf8");

const manifest = {
    version,
    tag,
    channel,
    publishedAt: new Date().toISOString(),
    minMacOS: "14.0",
    minWindows: "10.0",
    notes,
    assets,
};

const outPath = path.join(installersDir, "update-manifest.json");
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log("Generated update-manifest.json:", outPath, "platforms:", Object.keys(assets).join(", "));
