#!/usr/bin/env node
/**
 * Generate update-manifest.json & SHA256SUMS.txt for QLEX Beta/Stable Update Push Channel
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

const pkgName = `QLEX-${version}-macOS-arm64.pkg`;
const zipName = `QLEX-${version}-macOS-arm64.zip`;
const pkgPath = path.join(installersDir, pkgName);
const zipPath = path.join(installersDir, zipName);

function sha256(file) {
    return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const pkgSha = sha256(pkgPath);
const zipSha = sha256(zipPath);
const pkgSize = fs.statSync(pkgPath).size;
const zipSize = fs.statSync(zipPath).size;

fs.writeFileSync(
    path.join(installersDir, "SHA256SUMS.txt"),
    `${pkgSha}  ${pkgName}\n${zipSha}  ${zipName}\n`,
    "utf8"
);

const manifest = {
    version,
    tag,
    channel,
    publishedAt: new Date().toISOString(),
    minMacOS: "14.0",
    notes,
    assets: {
        "darwin-arm64": {
            pkgUrl: `https://github.com/${repo}/releases/download/${tag}/${pkgName}`,
            zipUrl: `https://github.com/${repo}/releases/download/${tag}/${zipName}`,
            sha256: pkgSha,
            zipSha256: zipSha,
            size: pkgSize,
            zipSize,
        },
    },
};

const outPath = path.join(installersDir, "update-manifest.json");
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log("Generated update-manifest.json:", outPath);
