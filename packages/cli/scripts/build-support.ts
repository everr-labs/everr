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
import { $ } from "zx";
import { embeddedAssets } from "./cli-build.ts";
import { type BuildPhases, noopBuildPhases } from "./build-telemetry.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const packageDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(packageDir, "..", "..");
const docsPublicDir = path.join(repoDir, "packages", "docs", "public");
const envFile = path.join(packageDir, ".env");
const cliEmbeddedAssetsDir = path.dirname(embeddedAssets.collectorGz);
export const CHDB_RELEASE_VERSION = "v26.5.0";

export type ChdbAsset = { assetName: string; sha256: string };

/**
 * Pinned chDB release assets keyed by `${process.platform}-${process.arch}`.
 * Each CLI target embeds the matching prebuilt `libchdb.so`.
 */
export const CHDB_PLATFORM_ASSETS: Record<string, ChdbAsset> = {
  "darwin-arm64": {
    assetName: "macos-arm64-libchdb.tar.gz",
    sha256: "86a77d5aa775902740d312153eddfbdc641b8fd5a2e028ddfd18d002ade9ec38",
  },
  "linux-arm64": {
    assetName: "linux-aarch64-libchdb.tar.gz",
    sha256: "ba590a475ff8824bdf7d463dded08a4f987ea4687cfb0a1de262b7e7d7bf2554",
  },
  "linux-x64": {
    assetName: "linux-x86_64-libchdb.tar.gz",
    sha256: "8dc5155d80b20a27d3e7322bb49ce003807ebd2b8cbd43896c829d16d24b0cdf",
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

function loadBuildEnvFile() {
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
  return `https://github.com/chdb-io/chdb-core/releases/download/${version}/${assetName}`;
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

export type CliEmbeddedAssets = typeof embeddedAssets;

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
  const { collectorGz, chdbGz } = embeddedAssets;

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
    await Promise.all([
      gzipFile(collectorPrepared, collectorGz),
      gzipFile(chdbPrepared, chdbGz),
    ]);
  });

  return { collectorGz, chdbGz };
}

async function signBinaryIfNeeded(binaryPath: string) {
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
