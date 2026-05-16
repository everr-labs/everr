#!/usr/bin/env node
// Sync packages/desktop-app/src-tauri/{Cargo.toml,tauri.conf.json} version
// fields to match packages/desktop-app/package.json after changesets bumps it.
import * as fs from "node:fs";
import * as path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const desktopAppDir = path.join(repoRoot, "packages", "desktop-app");
const pkgPath = path.join(desktopAppDir, "package.json");
const cargoPath = path.join(desktopAppDir, "src-tauri", "Cargo.toml");
const tauriConfPath = path.join(desktopAppDir, "src-tauri", "tauri.conf.json");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const version = pkg.version;
if (!version) {
  console.error(`No version field in ${pkgPath}`);
  process.exit(1);
}

function replaceCargoVersion(contents, nextVersion) {
  const lines = contents.split("\n");
  let inPackageSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("[") && line.trim().endsWith("]")) {
      inPackageSection = line.trim() === "[package]";
      continue;
    }
    if (inPackageSection && /^\s*version\s*=/.test(line)) {
      lines[i] = `version = "${nextVersion}"`;
      return lines.join("\n");
    }
  }
  throw new Error("Could not find [package].version in Cargo.toml");
}

const cargoContents = fs.readFileSync(cargoPath, "utf8");
const nextCargo = replaceCargoVersion(cargoContents, version);
if (nextCargo !== cargoContents) {
  fs.writeFileSync(cargoPath, nextCargo, "utf8");
  console.log(`Updated ${path.relative(repoRoot, cargoPath)} to ${version}`);
}

const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
if (tauriConf.version !== version) {
  tauriConf.version = version;
  fs.writeFileSync(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`, "utf8");
  console.log(
    `Updated ${path.relative(repoRoot, tauriConfPath)} to ${version}`,
  );
}
