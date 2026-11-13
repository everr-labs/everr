import { createHash } from "node:crypto";
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
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constants as zlib, zstdCompressSync } from "node:zlib";
import { $ } from "zx";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

const packageDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(packageDir, "..", "..");
const docsPublicDir = path.join(repoDir, "packages", "docs", "public");
const envFile = path.join(packageDir, ".env");
export const CHDB_RELEASE_VERSION = "v26.7.3";

export type ChdbAsset = { assetName: string; sha256: string };

/**
 * Pinned chDB release assets keyed by `${process.platform}-${process.arch}`.
 * Each CLI target embeds the matching prebuilt `libchdb.so`.
 */
export const CHDB_PLATFORM_ASSETS: Record<string, ChdbAsset> = {
  "darwin-arm64": {
    assetName: "macos-arm64-libchdb.tar.gz",
    sha256: "5640e50dccf711bf3dd5551333d08e43f433edf7bd94b2289f36c2539e627762",
  },
  "linux-arm64": {
    assetName: "linux-aarch64-libchdb.tar.gz",
    sha256: "d153adad1ff39b2e3caf0417f09d8bd9edd41939c7c67a3c4978a61e73fb9227",
  },
  "linux-x64": {
    assetName: "linux-x86_64-libchdb.tar.gz",
    sha256: "bc33260c32acf78eade2ac41a9115f38e00404651fa42e3bb4c419e4f011c031",
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

export async function prepareChdbLibAt(mode: string, destLib: string) {
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

// zstd at level 19 makes libchdb about a third smaller than gzip -9 and
// still unpacks in a fraction of a second.
export async function zstdFile(source: string, dest: string) {
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  await rm(tmp, { force: true });
  // The streaming compressor fails on Linux with multiple workers
  // (ERR_STREAM_PUSH_AFTER_EOF), so compress the whole buffer at once.
  const compressed = zstdCompressSync(await readFile(source), {
    params: {
      [zlib.ZSTD_c_compressionLevel]: 19,
      [zlib.ZSTD_c_nbWorkers]: os.availableParallelism(),
    },
  });
  await writeFile(tmp, compressed);
  await rm(dest, { force: true });
  await copyFile(tmp, dest);
  await rm(tmp, { force: true });
  console.log(`Compressed ${source} -> ${dest}`);
}

async function signBinaryIfNeeded(binaryPath: string) {
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
