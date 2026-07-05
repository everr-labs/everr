import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import { valid as validVersion } from "semver";
import { $ } from "zx";
import { type BuildPhases, noopBuildPhases } from "./build-telemetry.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const packageDir = path.resolve(scriptDir, "..");
export const repoDir = path.resolve(packageDir, "..", "..");
const cliDir = path.join(packageDir, "src-cli");
const docsPublicDir = path.join(repoDir, "packages", "docs", "public");
const envFile = path.join(packageDir, ".env");
const desktopPackageJsonPath = path.join(packageDir, "package.json");
const desktopTauriConfigPath = path.join(packageDir, "src-tauri", "tauri.conf.json");
const desktopTauriCargoTomlPath = path.join(packageDir, "src-tauri", "Cargo.toml");
const desktopResourceDir = path.join(repoDir, "target", "desktop-resources");
export const desktopReleaseDir = path.join(repoDir, "target", "desktop-release");
const cliEmbeddedAssetsDir = path.join(repoDir, "target", "cli-embedded-assets");
export const CHDB_RELEASE_VERSION = "v4.0.2";

export type ChdbAsset = { assetName: string; sha256: string };

/**
 * Pinned chDB release assets keyed by `${process.platform}-${process.arch}`.
 * Each desktop/CLI target embeds the matching prebuilt `libchdb.so`.
 */
export const CHDB_PLATFORM_ASSETS: Record<string, ChdbAsset> = {
  "darwin-arm64": {
    assetName: "macos-arm64-libchdb.tar.gz",
    sha256: "54b4da9c4d71f09b8a37e823a7addba392c4789a7034192a4863a1edd452f9e8",
  },
  "linux-arm64": {
    assetName: "linux-aarch64-libchdb.tar.gz",
    sha256: "ed43e29314f8337f858420354d88d5db4cce9c38155aff43f7816d1112cd7465",
  },
  "linux-x64": {
    assetName: "linux-x86_64-libchdb.tar.gz",
    sha256: "fb722f81c61c1fb2eb3511f17a5adc85b231f6bbc2415de6aea3ad9b73bb272e",
  },
};

export function resolveChdbAsset(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): ChdbAsset {
  const key = `${platform}-${arch}`;
  const asset = CHDB_PLATFORM_ASSETS[key];
  if (!asset) {
    throw new Error(
      `No bundled chDB release asset for ${key}. Supported platforms: ${Object.keys(
        CHDB_PLATFORM_ASSETS,
      ).join(", ")}.`,
    );
  }

  return asset;
}

const LOCAL_COLLECTOR_BIN_NAME = "everr-local-collector";
const CHDB_LIB_FILE_NAME = "libchdb.so";

let didLoadEnvFile = false;

export function loadBuildEnvFile() {
  if (!didLoadEnvFile) {
    didLoadEnvFile = true;

    try {
      process.loadEnvFile(envFile);
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }
}

function getEnv(name: string) {
  loadBuildEnvFile();
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function chdbReleaseAssetUrl(
  assetName = resolveChdbAsset().assetName,
  version = CHDB_RELEASE_VERSION,
) {
  return `https://github.com/chdb-io/chdb/releases/download/${version}/${assetName}`;
}

export async function sha256File(filePath: string) {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findFileByName(rootDir: string, fileName: string): Promise<string | undefined> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isFile() && entry.name === fileName) {
      return entryPath;
    }
    if (entry.isDirectory()) {
      const found = await findFileByName(entryPath, fileName);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

async function downloadChdbArchive(archivePath: string, asset: ChdbAsset) {
  await mkdir(path.dirname(archivePath), { recursive: true });
  const tmpPath = `${archivePath}.tmp`;
  await rm(tmpPath, { force: true });
  await $`curl --fail --location --silent --show-error --output ${tmpPath} ${chdbReleaseAssetUrl(
    asset.assetName,
  )}`;
  const digest = await sha256File(tmpPath);
  if (digest !== asset.sha256) {
    await rm(tmpPath, { force: true });
    throw new Error(
      `Downloaded ${asset.assetName} has sha256 ${digest}; expected ${asset.sha256}.`,
    );
  }
  await rm(archivePath, { force: true });
  await copyFile(tmpPath, archivePath);
  await rm(tmpPath, { force: true });
}

async function ensureChdbArchive(archivePath: string, asset: ChdbAsset) {
  if (await pathExists(archivePath)) {
    const digest = await sha256File(archivePath);
    if (digest === asset.sha256) {
      return;
    }
    console.error(
      `Ignoring cached ${archivePath} because sha256 is ${digest}; expected ${asset.sha256}.`,
    );
  }

  await downloadChdbArchive(archivePath, asset);
}

async function prepareChdbLibAt(mode: string, destLib: string) {
  if (mode !== "debug" && mode !== "release") {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  const asset = resolveChdbAsset();

  const chdbCacheDir = path.join(repoDir, "target", "chdb");
  const archivePath = path.join(chdbCacheDir, `${CHDB_RELEASE_VERSION}-${asset.assetName}`);
  const extractDir = path.join(chdbCacheDir, `${CHDB_RELEASE_VERSION}-extract`);

  await ensureChdbArchive(archivePath, asset);
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  await $`tar -xzf ${archivePath} -C ${extractDir}`;

  const extractedLib = await findFileByName(extractDir, "libchdb.so");
  if (!extractedLib) {
    throw new Error(`${asset.assetName} did not contain libchdb.so.`);
  }

  const extractedStat = await stat(extractedLib);
  if (!extractedStat.isFile()) {
    throw new Error(`Extracted libchdb.so is not a file: ${extractedLib}`);
  }

  await mkdir(path.dirname(destLib), { recursive: true });
  await copyFile(extractedLib, destLib);
  await chmod(destLib, 0o644);

  if (mode === "release") {
    await signBinaryIfNeeded(destLib);
  }

  console.log(`Prepared chDB library at ${destLib}`);
  return destLib;
}

async function gzipFile(source: string, dest: string) {
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  await rm(tmp, { force: true });
  await pipeline(createReadStream(source), createGzip({ level: 9 }), createWriteStream(tmp));
  await rm(dest, { force: true });
  await copyFile(tmp, dest);
  await rm(tmp, { force: true });
  console.log(`Compressed ${source} -> ${dest}`);
}

export type CliEmbeddedAssets = {
  collectorGz: string;
  chdbGz: string;
};

export async function prepareCliEmbeddedAssets(
  mode: string,
  telemetry: BuildPhases = noopBuildPhases,
): Promise<CliEmbeddedAssets> {
  if (mode !== "debug" && mode !== "release") {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  await mkdir(cliEmbeddedAssetsDir, { recursive: true });

  const collectorSource = path.join(repoDir, "collector", "build-local", LOCAL_COLLECTOR_BIN_NAME);
  const collectorPrepared = path.join(cliEmbeddedAssetsDir, LOCAL_COLLECTOR_BIN_NAME);
  const chdbPrepared = path.join(cliEmbeddedAssetsDir, CHDB_LIB_FILE_NAME);
  const collectorGz = `${collectorPrepared}.gz`;
  const chdbGz = `${chdbPrepared}.gz`;

  console.log(`Building local OTel collector for CLI embedding (${mode})...`);
  await telemetry.phase(
    "build embedded collector",
    () => $`make -C ${path.join(repoDir, "collector")} build-local`,
  );

  await copyFile(collectorSource, collectorPrepared);
  await chmod(collectorPrepared, 0o755);
  if (mode === "release") {
    await signBinaryIfNeeded(collectorPrepared);
  }

  await telemetry.phase("prepare chdb library", () => prepareChdbLibAt(mode, chdbPrepared));
  await telemetry.phase("compress embedded assets", async () => {
    await Promise.all([gzipFile(collectorPrepared, collectorGz), gzipFile(chdbPrepared, chdbGz)]);
  });

  return { collectorGz, chdbGz };
}

export function resolveCliBuild(mode: string) {
  switch (mode) {
    case "debug":
      return {
        buildArgs: ["--manifest-path", path.join(cliDir, "Cargo.toml")],
        builtBin: path.join(repoDir, "target", "debug", "everr"),
      };
    case "release":
      return {
        buildArgs: ["--release", "--manifest-path", path.join(cliDir, "Cargo.toml")],
        builtBin: path.join(repoDir, "target", "release", "everr"),
      };
    default:
      throw new Error(`Unsupported mode: ${mode}`);
  }
}

export async function signBinaryIfNeeded(binaryPath: string) {
  if (process.platform !== "darwin") {
    return;
  }

  const signingIdentity = getEnv("APPLE_SIGNING_IDENTITY") ?? "";
  if (signingIdentity === "") {
    console.error(`Skipping signing for ${binaryPath} because APPLE_SIGNING_IDENTITY is not set.`);
    return;
  }

  if (signingIdentity === "-" || !signingIdentity.includes("Developer ID Application:")) {
    throw new Error(
      `APPLE_SIGNING_IDENTITY must reference a Developer ID Application certificate to sign ${binaryPath}.`,
    );
  }

  console.log(`Signing ${binaryPath} with ${signingIdentity}...`);
  await $`codesign --force --sign ${signingIdentity} --options runtime --timestamp ${binaryPath}`;
}

export type PublishCliArtifactOptions = {
  outputDir?: string;
};

export async function publishCliArtifact(
  sourceBin: string,
  options: PublishCliArtifactOptions = {},
) {
  loadBuildEnvFile();

  const outputDir = options.outputDir ?? docsPublicDir;
  const outputBin = path.join(outputDir, "everr");
  const outputSha = path.join(outputDir, "everr.sha256");

  await mkdir(outputDir, { recursive: true });
  await copyFile(sourceBin, outputBin);
  await chmod(outputBin, 0o755);

  await signBinaryIfNeeded(outputBin);

  const digest = createHash("sha256")
    .update(await readFile(outputBin))
    .digest("hex");

  await writeFile(outputSha, `${digest}  everr\n`);

  console.log(`Wrote ${outputBin}`);
  console.log(`Wrote ${outputSha}`);

  return { outputBin, outputSha };
}

export async function installCliBinary(sourceBin: string, destName = "everr") {
  const installPath = path.join(process.env.HOME ?? "", ".local", "bin", destName);

  await mkdir(path.dirname(installPath), { recursive: true });
  await copyFile(sourceBin, installPath);
  await chmod(installPath, 0o755);

  console.log(`Installed Everr CLI to ${installPath}`);

  return installPath;
}

export type DesktopVersionPaths = {
  packageJsonPath: string;
  tauriConfigPath: string;
  tauriCargoTomlPath: string;
};

export const defaultDesktopVersionPaths: DesktopVersionPaths = {
  packageJsonPath: desktopPackageJsonPath,
  tauriConfigPath: desktopTauriConfigPath,
  tauriCargoTomlPath: desktopTauriCargoTomlPath,
};

type VersionedJsonFile = {
  version?: string;
};

function normalizeDesktopVersion(version: string) {
  const normalized = validVersion(version.trim());
  if (!normalized) {
    throw new Error(
      `Unsupported desktop app version "${version}". Expected a semantic version in the form X.Y.Z.`,
    );
  }

  return normalized;
}

export type DesktopReleaseIdentity = {
  desktopVersion: string;
  releaseSha: string;
  releaseShortSha: string;
  source: "github-actions" | "local";
};

function releaseShortSha(releaseSha: string) {
  return releaseSha === "unknown" ? "unknown" : releaseSha.slice(0, 7);
}

function normalizeReleaseSha(value: string) {
  const trimmed = value.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(trimmed)) {
    throw new Error(`GITHUB_SHA must look like a git commit SHA; got "${value}".`);
  }

  return trimmed;
}

export function resolveDesktopReleaseIdentity({
  env = process.env,
  desktopVersion,
  fallbackSha,
}: {
  env?: NodeJS.ProcessEnv;
  desktopVersion: string;
  fallbackSha?: string;
}): DesktopReleaseIdentity {
  const envReleaseSha = env.EVERR_RELEASE_SHA?.trim();
  const envReleaseShortSha = env.EVERR_RELEASE_SHORT_SHA?.trim();
  const normalizedDesktopVersion = normalizeDesktopVersion(desktopVersion);

  if (envReleaseSha) {
    const releaseSha = envReleaseSha;

    return {
      desktopVersion: normalizedDesktopVersion,
      releaseSha,
      releaseShortSha: envReleaseShortSha || releaseShortSha(releaseSha),
      source: env.GITHUB_SHA ? "github-actions" : "local",
    };
  }

  const githubSha = env.GITHUB_SHA?.trim();

  if (githubSha) {
    const releaseSha = normalizeReleaseSha(githubSha);

    return {
      desktopVersion: normalizedDesktopVersion,
      releaseSha,
      releaseShortSha: releaseShortSha(releaseSha),
      source: "github-actions",
    };
  }

  const releaseSha = fallbackSha?.trim() || "unknown";

  return {
    desktopVersion: normalizedDesktopVersion,
    releaseSha,
    releaseShortSha: releaseShortSha(releaseSha),
    source: "local",
  };
}

export function resolveDesktopReleaseIngestKey({
  env = process.env,
  required = false,
}: {
  env?: NodeJS.ProcessEnv;
  required?: boolean;
} = {}) {
  const ingestKey = env.EVERR_INGEST_KEY?.trim();
  if (ingestKey) {
    return ingestKey;
  }

  if (required) {
    throw new Error(
      "EVERR_INGEST_KEY is required for CI desktop release builds so bundled production telemetry can authenticate to Everr ingest.",
    );
  }

  return undefined;
}

export async function writeDesktopReleaseTauriConfigOverride({
  outputPath,
  desktopVersion,
}: {
  outputPath: string;
  desktopVersion: string;
}) {
  const version = normalizeDesktopVersion(desktopVersion);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ version }, null, 2)}\n`);
  return outputPath;
}

async function readDesktopVersionJson(
  pathname: string,
): Promise<VersionedJsonFile & { version: string }> {
  const file: VersionedJsonFile = JSON.parse(await readFile(pathname, "utf8"));
  if (!file.version) {
    throw new Error(`Could not resolve desktop app version from ${pathname}.`);
  }

  return {
    ...file,
    version: file.version,
  };
}

export async function readDesktopTauriConfigVersion(paths = defaultDesktopVersionPaths) {
  return (await readDesktopVersionJson(paths.tauriConfigPath)).version;
}
