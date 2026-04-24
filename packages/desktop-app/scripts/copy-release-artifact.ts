import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { arch as getArch, platform as getPlatform } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { docsPublicDir, loadBuildEnvFile } from "./build-support.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(packageDir, "..", "..");
const bundleDirs = [
  path.join(repoDir, "target", "release", "bundle"),
  path.join(packageDir, "src-tauri", "target", "release", "bundle"),
];
const DEFAULT_RELEASE_REPO = "everr-labs/everr";
const RELEASE_TAG_PREFIX = "desktop-v";

function releaseTagFor(version: string) {
  return `${RELEASE_TAG_PREFIX}${version}`;
}

export function buildReleaseAssetUrl({
  repo,
  version,
  assetName,
}: {
  repo: string;
  version: string;
  assetName: string;
}) {
  return `https://github.com/${repo}/releases/download/${releaseTagFor(version)}/${assetName}`;
}

export type DesktopReleaseTarget = {
  platform: "macos";
  arch: "arm64";
  updaterTarget: "darwin-aarch64";
  dmgName: string;
  updaterArchiveName: string;
  updaterSignatureName: string;
};

type ReleaseArtifacts = {
  dmg: string;
  updaterArchive: string;
  updaterSignature: string;
};

export function normalizePlatform(value: NodeJS.Platform) {
  switch (value) {
    case "darwin":
      return "macos";
    default:
      return value;
  }
}

export function getDesktopReleaseTarget(
  platform: string,
  arch: string,
): DesktopReleaseTarget {
  if (platform !== "macos" || arch !== "arm64") {
    throw new Error(`Unsupported desktop release target: ${platform}-${arch}`);
  }

  return {
    platform: "macos",
    arch: "arm64",
    updaterTarget: "darwin-aarch64",
    dmgName: "everr-macos-arm64.dmg",
    updaterArchiveName: "everr-macos-arm64.app.tar.gz",
    updaterSignatureName: "everr-macos-arm64.app.tar.gz.sig",
  };
}

export function buildUpdaterManifest({
  version,
  pubDate,
  downloadUrl,
  signature,
  updaterTarget,
}: {
  version: string;
  pubDate: string;
  downloadUrl: string;
  signature: string;
  updaterTarget: string;
}) {
  return `${JSON.stringify(
    {
      version,
      pub_date: pubDate,
      platforms: {
        [updaterTarget]: {
          url: downloadUrl,
          signature,
        },
      },
    },
    null,
    2,
  )}\n`;
}

async function pathExists(value: string) {
  try {
    await stat(value);
    return true;
  } catch {
    return false;
  }
}

async function findFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await findFiles(entryPath)));
      continue;
    }

    files.push(entryPath);
  }

  return files;
}

async function findBundleDir() {
  for (const dir of bundleDirs) {
    if (await pathExists(dir)) {
      return dir;
    }
  }

  throw new Error("Could not locate the Tauri release bundle directory.");
}

async function findNewestFileWithSuffix(dir: string, suffix: string) {
  const candidates = (await findFiles(dir)).filter((file) => file.endsWith(suffix));

  if (candidates.length === 0) {
    return null;
  }

  const candidatesWithStats = await Promise.all(
    candidates.map(async (file) => ({
      file,
      stat: await stat(file),
    })),
  );

  candidatesWithStats.sort(
    (left, right) =>
      right.stat.mtimeMs - left.stat.mtimeMs || left.file.localeCompare(right.file),
  );

  return candidatesWithStats[0];
}

export async function findReleaseArtifacts(bundleDir: string): Promise<ReleaseArtifacts> {
  const dmg = await findNewestFileWithSuffix(bundleDir, ".dmg");
  const updaterArchive = await findNewestFileWithSuffix(bundleDir, ".app.tar.gz");

  if (!dmg || !updaterArchive) {
    throw new Error(
      "Could not locate the desktop release DMG and updater archive in the Tauri bundle directory. On macOS, build with both the app and dmg bundle targets so Tauri can generate updater artifacts.",
    );
  }

  const updaterSignature = `${updaterArchive.file}.sig`;
  if (!(await pathExists(updaterSignature))) {
    throw new Error(
      `Missing updater signature for ${path.basename(updaterArchive.file)}. Set TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_PRIVATE_KEY_PASSWORD before building the release.`,
    );
  }

  return {
    dmg: dmg.file,
    updaterArchive: updaterArchive.file,
    updaterSignature,
  };
}

async function removeStaleArtifacts(dir: string, target: DesktopReleaseTarget) {
  if (!(await pathExists(dir))) {
    return;
  }

  const legacyPrefix = `everr-app-${target.platform}-${target.arch}`;
  const staleEntries = new Set([
    "latest.json",
    target.dmgName,
    target.updaterArchiveName,
    target.updaterSignatureName,
  ]);
  const entries = await readdir(dir);

  await Promise.all(
    entries
      .filter(
        (entry) =>
          staleEntries.has(entry) ||
          entry.startsWith(`${legacyPrefix}.`) ||
          entry === `${target.platform}-${target.arch}` ||
          entry === `darwin-${target.arch}`,
      )
      .map((entry) => rm(path.join(dir, entry), { force: true, recursive: true })),
  );
}

async function readDesktopVersion() {
  const configPath = path.join(packageDir, "src-tauri", "tauri.conf.json");
  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    version?: string;
  };

  if (!config.version) {
    throw new Error(`Could not resolve desktop app version from ${configPath}.`);
  }

  return config.version;
}

function resolveReleaseRepo() {
  loadBuildEnvFile();
  return (process.env.EVERR_RELEASE_REPO?.trim() || DEFAULT_RELEASE_REPO).replace(
    /\/+$/,
    "",
  );
}

function runGh(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`gh ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function ghReleaseExists(repo: string, tag: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", ["release", "view", tag, "--repo", repo], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code === 0));
  });
}

async function uploadToGitHubRelease({
  repo,
  version,
  artifacts,
}: {
  repo: string;
  version: string;
  artifacts: ReleaseArtifacts;
}) {
  const tag = releaseTagFor(version);
  const assets = [artifacts.dmg, artifacts.updaterArchive, artifacts.updaterSignature];

  if (await ghReleaseExists(repo, tag)) {
    await runGh([
      "release",
      "upload",
      tag,
      ...assets,
      "--clobber",
      "--repo",
      repo,
    ]);
  } else {
    await runGh([
      "release",
      "create",
      tag,
      ...assets,
      "--repo",
      repo,
      "--title",
      `Desktop ${version}`,
      "--generate-notes",
    ]);
  }
}

export async function copyReleaseArtifact() {
  loadBuildEnvFile();

  const platform = normalizePlatform(getPlatform());
  const arch = getArch();
  const target = getDesktopReleaseTarget(platform, arch);
  const bundleDir = await findBundleDir();
  const artifacts = await findReleaseArtifacts(bundleDir);
  const destDir = path.join(docsPublicDir, "everr-app");
  const version = await readDesktopVersion();
  const repo = resolveReleaseRepo();
  const updaterSignature = (await readFile(artifacts.updaterSignature, "utf8")).trim();

  await uploadToGitHubRelease({ repo, version, artifacts });

  const updaterArchiveUrl = buildReleaseAssetUrl({
    repo,
    version,
    assetName: target.updaterArchiveName,
  });
  const manifest = buildUpdaterManifest({
    version,
    pubDate: new Date().toISOString(),
    downloadUrl: updaterArchiveUrl,
    signature: updaterSignature,
    updaterTarget: target.updaterTarget,
  });

  await mkdir(destDir, { recursive: true });
  await removeStaleArtifacts(destDir, target);
  await writeFile(path.join(destDir, "latest.json"), manifest);

  console.log(`Uploaded desktop ${version} assets to ${repo} release ${releaseTagFor(version)}`);
  console.log(`Wrote updater manifest to ${path.join(destDir, "latest.json")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await copyReleaseArtifact();
}
