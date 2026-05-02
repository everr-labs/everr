import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
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
import { $ } from "zx";
import {
  desktopReleaseDir,
  loadBuildEnvFile,
  resolveDesktopReleaseIdentity,
} from "./build-support.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(packageDir, "..", "..");
const bundleDirs = [
  path.join(repoDir, "target", "release", "bundle"),
  path.join(packageDir, "src-tauri", "target", "release", "bundle"),
];
const DEFAULT_PUBLIC_BASE_URL = "https://everr.dev/everr-app";
const RELEASE_CHECKSUMS_NAME = "SHA256SUMS";
const RELEASE_METADATA_NAME = "release-metadata.json";

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

export type DmgNotarizationRequest = {
  dmgPath: string;
  keyId: string;
  keyPath: string;
  issuer: string;
};

type ReleaseFileEntry = {
  path: string;
  sha256: string;
  size: number;
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

export function buildPublicArtifactUrl({
  baseUrl,
  assetName,
}: {
  baseUrl: string;
  assetName: string;
}) {
  return `${baseUrl.replace(/\/+$/, "")}/${assetName}`;
}

export function buildUpdaterManifest({
  version,
  releaseShortSha,
  pubDate,
  downloadUrl,
  signature,
  updaterTarget,
}: {
  version: string;
  releaseShortSha: string;
  pubDate: string;
  downloadUrl: string;
  signature: string;
  updaterTarget: string;
}) {
  return `${JSON.stringify(
    {
      version,
      notes: `Everr desktop release ${releaseShortSha}`,
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

export function buildReleaseMetadata({
  platformVersion,
  releaseSha,
  releaseShortSha,
  publicBaseUrl,
  target,
  files,
  createdAt,
}: {
  platformVersion: string;
  releaseSha: string;
  releaseShortSha: string;
  publicBaseUrl: string;
  target: DesktopReleaseTarget;
  files: ReleaseFileEntry[];
  createdAt: string;
}) {
  return `${JSON.stringify(
    {
      schema_version: 1,
      product: "Everr",
      version: platformVersion,
      platform_version: platformVersion,
      release_sha: releaseSha,
      release_short_sha: releaseShortSha,
      public_base_url: publicBaseUrl,
      target,
      build: {
        github_repository: process.env.GITHUB_REPOSITORY ?? null,
        github_ref: process.env.GITHUB_REF ?? null,
        github_sha: process.env.GITHUB_SHA ?? null,
        github_run_id: process.env.GITHUB_RUN_ID ?? null,
        created_at: createdAt,
      },
      files,
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

export function resolveDmgNotarizationRequest({
  platform = process.platform,
  env = process.env,
  dmgPath,
}: {
  platform?: NodeJS.Platform | string;
  env?: NodeJS.ProcessEnv;
  dmgPath: string;
}): DmgNotarizationRequest | null {
  if (platform !== "darwin") {
    return null;
  }

  const keyId = env.APPLE_API_KEY?.trim();
  const keyPath = env.APPLE_API_KEY_PATH?.trim();
  const issuer = env.APPLE_API_ISSUER?.trim();

  if (!keyId || !keyPath || !issuer) {
    return null;
  }

  return {
    dmgPath,
    keyId,
    keyPath,
    issuer,
  };
}

export async function notarizeDmgIfConfigured(dmgPath: string) {
  loadBuildEnvFile();

  const request = resolveDmgNotarizationRequest({ dmgPath });
  if (!request) {
    console.error(
      `Skipping DMG notarization for ${dmgPath} because this is not macOS or App Store Connect API credentials are not configured.`,
    );
    return;
  }

  console.log(`Submitting ${dmgPath} for Apple notarization...`);
  await $`xcrun notarytool submit ${request.dmgPath} --key ${request.keyPath} --key-id ${request.keyId} --issuer ${request.issuer} --wait`;
  await $`xcrun stapler staple ${request.dmgPath}`;
}

export async function notarizeReleaseDmgIfConfigured() {
  const bundleDir = await findBundleDir();
  const artifacts = await findReleaseArtifacts(bundleDir);
  await notarizeDmgIfConfigured(artifacts.dmg);
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

function resolvePublicBaseUrl() {
  loadBuildEnvFile();
  return (
    process.env.EVERR_DESKTOP_PUBLIC_BASE_URL?.trim() || DEFAULT_PUBLIC_BASE_URL
  ).replace(/\/+$/, "");
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });

  return hash.digest("hex");
}

function releaseRelativePath(rootDir: string, filePath: string) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

async function describeReleaseFile(
  rootDir: string,
  filePath: string,
): Promise<ReleaseFileEntry> {
  const fileStat = await stat(filePath);
  return {
    path: releaseRelativePath(rootDir, filePath),
    sha256: await sha256File(filePath),
    size: fileStat.size,
  };
}

async function copyReleaseFile(rootDir: string, source: string, dest: string) {
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(source, dest);
  return describeReleaseFile(rootDir, dest);
}

async function collectReleaseFiles(rootDir: string) {
  const files = await findFiles(rootDir);
  const ignored = new Set([RELEASE_CHECKSUMS_NAME, RELEASE_METADATA_NAME]);
  const entries = await Promise.all(
    files
      .filter((file) => !ignored.has(releaseRelativePath(rootDir, file)))
      .map((file) => describeReleaseFile(rootDir, file)),
  );

  entries.sort((left, right) => left.path.localeCompare(right.path));
  return entries;
}

async function assertCliArtifactsPresent(rootDir: string) {
  const missing: string[] = [];
  for (const name of ["everr", "everr.sha256"]) {
    if (!(await pathExists(path.join(rootDir, name)))) {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing staged CLI artifact(s): ${missing.join(", ")}. The desktop release build must run the release CLI sidecar preparation before staging artifacts.`,
    );
  }
}

export async function writeReleaseChecksums(rootDir: string) {
  await rm(path.join(rootDir, RELEASE_CHECKSUMS_NAME), { force: true });

  const files = await findFiles(rootDir);
  const entries = await Promise.all(
    files
      .filter((file) => releaseRelativePath(rootDir, file) !== RELEASE_CHECKSUMS_NAME)
      .map(async (file) => ({
        path: releaseRelativePath(rootDir, file),
        sha256: await sha256File(file),
      })),
  );

  entries.sort((left, right) => left.path.localeCompare(right.path));

  const checksumsPath = path.join(rootDir, RELEASE_CHECKSUMS_NAME);
  await writeFile(
    checksumsPath,
    entries.map((entry) => `${entry.sha256}  ${entry.path}`).join("\n") + "\n",
  );

  return checksumsPath;
}

export async function stageReleaseArtifacts() {
  loadBuildEnvFile();

  const platform = normalizePlatform(getPlatform());
  const arch = getArch();
  const target = getDesktopReleaseTarget(platform, arch);
  const bundleDir = await findBundleDir();
  const artifacts = await findReleaseArtifacts(bundleDir);
  const appDestDir = path.join(desktopReleaseDir, "everr-app");
  const fallbackVersion = await readDesktopVersion();
  const identity = resolveDesktopReleaseIdentity({
    fallbackVersion: process.env.EVERR_PLATFORM_VERSION ?? fallbackVersion,
    fallbackSha: process.env.EVERR_RELEASE_SHA ?? process.env.GITHUB_SHA,
  });
  const publicBaseUrl = resolvePublicBaseUrl();
  const createdAt = new Date().toISOString();

  await mkdir(desktopReleaseDir, { recursive: true });
  await assertCliArtifactsPresent(desktopReleaseDir);
  await rm(appDestDir, { recursive: true, force: true });
  await mkdir(appDestDir, { recursive: true });

  await copyReleaseFile(
    desktopReleaseDir,
    artifacts.dmg,
    path.join(appDestDir, target.dmgName),
  );
  await copyReleaseFile(
    desktopReleaseDir,
    artifacts.updaterArchive,
    path.join(appDestDir, target.updaterArchiveName),
  );
  await copyReleaseFile(
    desktopReleaseDir,
    artifacts.updaterSignature,
    path.join(appDestDir, target.updaterSignatureName),
  );

  const updaterSignature = (
    await readFile(path.join(appDestDir, target.updaterSignatureName), "utf8")
  ).trim();
  const updaterArchiveUrl = buildPublicArtifactUrl({
    baseUrl: publicBaseUrl,
    assetName: target.updaterArchiveName,
  });
  const manifest = buildUpdaterManifest({
    version: identity.platformVersion,
    releaseShortSha: identity.releaseShortSha,
    pubDate: createdAt,
    downloadUrl: updaterArchiveUrl,
    signature: updaterSignature,
    updaterTarget: target.updaterTarget,
  });

  await writeFile(path.join(appDestDir, "latest.json"), manifest);

  const files = await collectReleaseFiles(desktopReleaseDir);
  await writeFile(
    path.join(desktopReleaseDir, RELEASE_METADATA_NAME),
    buildReleaseMetadata({
      platformVersion: identity.platformVersion,
      releaseSha: identity.releaseSha,
      releaseShortSha: identity.releaseShortSha,
      publicBaseUrl,
      target,
      files,
      createdAt,
    }),
  );
  await writeReleaseChecksums(desktopReleaseDir);

  console.log(
    `Staged desktop ${identity.releaseShortSha} (${identity.platformVersion}) release artifacts in ${desktopReleaseDir}`,
  );
  console.log(`Wrote updater manifest to ${path.join(appDestDir, "latest.json")}`);
}

export const copyReleaseArtifact = stageReleaseArtifacts;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await stageReleaseArtifacts();
}
