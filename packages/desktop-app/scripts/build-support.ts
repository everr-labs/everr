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
import { parse as parseVersion, valid as validVersion } from "semver";
import { $ } from "zx";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const packageDir = path.resolve(scriptDir, "..");
export const repoDir = path.resolve(packageDir, "..", "..");
export const cliDir = path.join(packageDir, "src-cli");
export const docsPublicDir = path.join(repoDir, "packages", "docs", "public");
export const envFile = path.join(packageDir, ".env");
export const desktopPackageJsonPath = path.join(packageDir, "package.json");
export const desktopTauriConfigPath = path.join(packageDir, "src-tauri", "tauri.conf.json");
export const desktopTauriCargoTomlPath = path.join(packageDir, "src-tauri", "Cargo.toml");
export const desktopResourceDir = path.join(repoDir, "target", "desktop-resources");
export const desktopReleaseDir = path.join(repoDir, "target", "desktop-release");
export const cliEmbeddedAssetsDir = path.join(repoDir, "target", "cli-embedded-assets");
export const CHDB_RELEASE_VERSION = "v4.0.2";
export const CHDB_LIB_ASSET_NAME = "macos-arm64-libchdb.tar.gz";
export const CHDB_LIB_ARCHIVE_SHA256 =
  "54b4da9c4d71f09b8a37e823a7addba392c4789a7034192a4863a1edd452f9e8";
export const LOCAL_COLLECTOR_BIN_NAME = "everr-local-collector";
export const CHDB_LIB_FILE_NAME = "libchdb.so";
export const LEGACY_CLI_RELEASE_BINARY_NAME = "everr";

export type ChdbLibAsset = {
  assetName: string;
  archiveSha256: string;
};

export type CliReleaseTarget = {
  platform: "macos" | "linux";
  arch: "arm64" | "x64";
  binaryName: string;
  checksumName: string;
};

export const CLI_RELEASE_TARGETS: CliReleaseTarget[] = [
  {
    platform: "macos",
    arch: "arm64",
    binaryName: "everr-macos-arm64",
    checksumName: "everr-macos-arm64.sha256",
  },
  {
    platform: "linux",
    arch: "x64",
    binaryName: "everr-linux-x64",
    checksumName: "everr-linux-x64.sha256",
  },
  {
    platform: "linux",
    arch: "arm64",
    binaryName: "everr-linux-arm64",
    checksumName: "everr-linux-arm64.sha256",
  },
];

const CHDB_LIB_ASSETS_BY_TARGET: Record<string, ChdbLibAsset> = {
  "darwin:arm64": {
    assetName: CHDB_LIB_ASSET_NAME,
    archiveSha256: CHDB_LIB_ARCHIVE_SHA256,
  },
  "linux:x64": {
    assetName: "linux-x86_64-libchdb.tar.gz",
    archiveSha256: "fb722f81c61c1fb2eb3511f17a5adc85b231f6bbc2415de6aea3ad9b73bb272e",
  },
  "linux:arm64": {
    assetName: "linux-aarch64-libchdb.tar.gz",
    archiveSha256: "ed43e29314f8337f858420354d88d5db4cce9c38155aff43f7816d1112cd7465",
  },
};

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
  version = CHDB_RELEASE_VERSION,
  assetName = CHDB_LIB_ASSET_NAME,
) {
  return `https://github.com/chdb-io/chdb/releases/download/${version}/${assetName}`;
}

export function resolveChdbLibAsset(
  platform = process.platform,
  arch = process.arch,
): ChdbLibAsset {
  const asset = CHDB_LIB_ASSETS_BY_TARGET[`${platform}:${arch}`];
  if (!asset) {
    throw new Error(
      `Bundled chDB resources are not supported on ${platform}/${arch}. Supported targets are macOS arm64, Linux x64, and Linux arm64.`,
    );
  }

  return asset;
}

function normalizeCliReleasePlatform(platform: string) {
  return platform === "darwin" ? "macos" : platform;
}

function normalizeCliReleaseArch(arch: string) {
  switch (arch) {
    case "amd64":
    case "x86_64":
      return "x64";
    case "aarch64":
      return "arm64";
    default:
      return arch;
  }
}

export function getCliReleaseTarget(
  platform = process.platform,
  arch = process.arch,
): CliReleaseTarget {
  const normalizedPlatform = normalizeCliReleasePlatform(platform);
  const normalizedArch = normalizeCliReleaseArch(arch);
  const target = CLI_RELEASE_TARGETS.find(
    (candidate) =>
      candidate.platform === normalizedPlatform && candidate.arch === normalizedArch,
  );

  if (!target) {
    throw new Error(
      `Unsupported CLI release target: ${platform}/${arch}. Supported targets are macOS arm64, Linux x64, and Linux arm64.`,
    );
  }

  return target;
}

export async function sha256File(filePath: string) {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
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

async function downloadChdbArchive(archivePath: string, asset: ChdbLibAsset) {
  await mkdir(path.dirname(archivePath), { recursive: true });
  const tmpPath = `${archivePath}.tmp`;
  await rm(tmpPath, { force: true });
  await $`curl --fail --location --silent --show-error --output ${tmpPath} ${chdbReleaseAssetUrl(
    CHDB_RELEASE_VERSION,
    asset.assetName,
  )}`;
  const digest = await sha256File(tmpPath);
  if (digest !== asset.archiveSha256) {
    await rm(tmpPath, { force: true });
    throw new Error(
      `Downloaded ${asset.assetName} has sha256 ${digest}; expected ${asset.archiveSha256}.`,
    );
  }
  await rm(archivePath, { force: true });
  await copyFile(tmpPath, archivePath);
  await rm(tmpPath, { force: true });
}

async function ensureChdbArchive(archivePath: string, asset: ChdbLibAsset) {
  if (await pathExists(archivePath)) {
    const digest = await sha256File(archivePath);
    if (digest === asset.archiveSha256) {
      return;
    }
    console.error(
      `Ignoring cached ${archivePath} because sha256 is ${digest}; expected ${asset.archiveSha256}.`,
    );
  }

  await downloadChdbArchive(archivePath, asset);
}

export async function prepareChdbLibResource(mode: string) {
  return prepareChdbLibAt(mode, path.join(desktopResourceDir, CHDB_LIB_FILE_NAME));
}

async function prepareChdbLibAt(mode: string, destLib: string) {
  if (mode !== "debug" && mode !== "release") {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  const chdbAsset = resolveChdbLibAsset();

  const chdbCacheDir = path.join(repoDir, "target", "chdb");
  const archivePath = path.join(chdbCacheDir, `${CHDB_RELEASE_VERSION}-${chdbAsset.assetName}`);
  const extractDir = path.join(chdbCacheDir, `${CHDB_RELEASE_VERSION}-extract`);

  await ensureChdbArchive(archivePath, chdbAsset);
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  await $`tar -xzf ${archivePath} -C ${extractDir}`;

  const extractedLib = await findFileByName(extractDir, "libchdb.so");
  if (!extractedLib) {
    throw new Error(`${chdbAsset.assetName} did not contain libchdb.so.`);
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

export async function prepareCliEmbeddedAssets(mode: string): Promise<CliEmbeddedAssets> {
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
  await $`make -C ${path.join(repoDir, "collector")} build-local`;

  await copyFile(collectorSource, collectorPrepared);
  await chmod(collectorPrepared, 0o755);
  if (mode === "release") {
    await signBinaryIfNeeded(collectorPrepared);
  }

  await prepareChdbLibAt(mode, chdbPrepared);
  await gzipFile(collectorPrepared, collectorGz);
  await gzipFile(chdbPrepared, chdbGz);

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

export async function resolveTargetTriple() {
  const envTriple = getEnv("TAURI_ENV_TARGET_TRIPLE");
  if (envTriple) {
    if (envTriple.includes("windows")) {
      throw new Error("Windows targets are not supported by the desktop build scripts.");
    }

    return envTriple;
  }

  const output = await $`rustc -vV`;
  const hostLine = output.stdout
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("host: "));

  const targetTriple = hostLine?.slice("host: ".length).trim();
  if (!targetTriple) {
    throw new Error("Could not resolve target triple.");
  }

  if (targetTriple.includes("windows")) {
    throw new Error("Windows targets are not supported by the desktop build scripts.");
  }

  return targetTriple;
}

export async function signBinaryIfNeeded(binaryPath: string) {
  if (process.platform !== "darwin") {
    return;
  }

  const signingIdentity = getEnv("APPLE_SIGNING_IDENTITY") ?? "";
  if (signingIdentity === "") {
    console.error(
      `Skipping signing for ${binaryPath} because APPLE_SIGNING_IDENTITY is not set.`,
    );
    return;
  }

  if (
    signingIdentity === "-" ||
    !signingIdentity.includes("Developer ID Application:")
  ) {
    throw new Error(
      `APPLE_SIGNING_IDENTITY must reference a Developer ID Application certificate to sign ${binaryPath}.`,
    );
  }

  console.log(`Signing ${binaryPath} with ${signingIdentity}...`);
  await $`codesign --force --sign ${signingIdentity} --options runtime --timestamp ${binaryPath}`;
}

export type PublishCliArtifactOptions = {
  outputDir?: string;
  target?: CliReleaseTarget;
  writeLegacyAlias?: boolean;
};

export async function publishCliArtifact(
  sourceBin: string,
  options: PublishCliArtifactOptions = {},
) {
  loadBuildEnvFile();

  const outputDir = options.outputDir ?? docsPublicDir;
  const target = options.target ?? getCliReleaseTarget();
  const outputBin = path.join(outputDir, target.binaryName);
  const outputSha = path.join(outputDir, target.checksumName);

  await mkdir(outputDir, { recursive: true });
  await copyFile(sourceBin, outputBin);
  await chmod(outputBin, 0o755);

  if (target.platform === "macos") {
    await signBinaryIfNeeded(outputBin);
  }

  const digest = createHash("sha256")
    .update(await readFile(outputBin))
    .digest("hex");

  await writeFile(outputSha, `${digest}  ${target.binaryName}\n`);

  if (options.writeLegacyAlias) {
    const legacyBin = path.join(outputDir, LEGACY_CLI_RELEASE_BINARY_NAME);
    const legacySha = path.join(outputDir, `${LEGACY_CLI_RELEASE_BINARY_NAME}.sha256`);

    await copyFile(outputBin, legacyBin);
    await chmod(legacyBin, 0o755);
    await writeFile(legacySha, `${digest}  ${LEGACY_CLI_RELEASE_BINARY_NAME}\n`);
    console.log(`Wrote ${legacyBin}`);
    console.log(`Wrote ${legacySha}`);
  }

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
  platformVersion: string;
  releaseSha: string;
  releaseShortSha: string;
  source: "github-actions" | "local";
};

function releaseShortSha(releaseSha: string) {
  return releaseSha === "unknown" ? "unknown" : releaseSha.slice(0, 7);
}

function normalizeGithubRunNumber(value: string) {
  const trimmed = value.trim();
  if (!/^[1-9][0-9]*$/.test(trimmed)) {
    throw new Error(
      `GITHUB_RUN_NUMBER must be a positive integer to generate a desktop platform version; got "${value}".`,
    );
  }

  return trimmed;
}

function buildGithubActionsPlatformVersion(fallbackVersion: string, githubRunNumber: string) {
  const parsed = parseVersion(normalizeDesktopVersion(fallbackVersion));
  if (!parsed) {
    throw new Error(
      `Unsupported desktop app version "${fallbackVersion}". Expected a semantic version in the form X.Y.Z.`,
    );
  }

  return normalizeDesktopVersion(
    `${parsed.major}.${parsed.minor}.${parsed.patch + Number(githubRunNumber)}`,
  );
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
  fallbackVersion,
  fallbackSha,
}: {
  env?: NodeJS.ProcessEnv;
  fallbackVersion: string;
  fallbackSha?: string;
}): DesktopReleaseIdentity {
  const envPlatformVersion = env.EVERR_PLATFORM_VERSION?.trim();
  const envReleaseSha = env.EVERR_RELEASE_SHA?.trim();
  const envReleaseShortSha = env.EVERR_RELEASE_SHORT_SHA?.trim();

  if (envPlatformVersion) {
    const platformVersion = normalizeDesktopVersion(envPlatformVersion);
    const releaseSha = envReleaseSha || fallbackSha?.trim() || "unknown";

    return {
      platformVersion,
      releaseSha,
      releaseShortSha: envReleaseShortSha || releaseShortSha(releaseSha),
      source: env.GITHUB_SHA && env.GITHUB_RUN_NUMBER ? "github-actions" : "local",
    };
  }

  const githubSha = env.GITHUB_SHA?.trim();
  const githubRunNumber = env.GITHUB_RUN_NUMBER?.trim();

  if (githubSha && githubRunNumber) {
    const releaseSha = normalizeReleaseSha(githubSha);
    const platformVersion = buildGithubActionsPlatformVersion(
      fallbackVersion,
      normalizeGithubRunNumber(githubRunNumber),
    );

    return {
      platformVersion,
      releaseSha,
      releaseShortSha: releaseShortSha(releaseSha),
      source: "github-actions",
    };
  }

  const platformVersion = normalizeDesktopVersion(fallbackVersion);
  const releaseSha = fallbackSha?.trim() || "unknown";

  return {
    platformVersion,
    releaseSha,
    releaseShortSha: releaseShortSha(releaseSha),
    source: "local",
  };
}

export async function writeDesktopReleaseTauriConfigOverride({
  outputPath,
  platformVersion,
}: {
  outputPath: string;
  platformVersion: string;
}) {
  const version = normalizeDesktopVersion(platformVersion);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({ version }, null, 2)}\n`);
  return outputPath;
}

async function readDesktopVersionJson(
  pathname: string,
): Promise<VersionedJsonFile & { version: string }> {
  const file = JSON.parse(await readFile(pathname, "utf8")) as VersionedJsonFile;
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
