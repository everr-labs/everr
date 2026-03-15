import { arch as getArch, platform as getPlatform } from "node:os";
import path from "node:path";
import { chmod, copyFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(packageDir, "..", "..");
const bundleDirs = [
  path.join(repoDir, "target", "release", "bundle"),
  path.join(packageDir, "src-tauri", "target", "release", "bundle"),
];

const artifactMatchers = {
  macos: [".dmg"],
  linux: [".AppImage", ".deb", ".rpm"],
  windows: [".msi", ".exe"],
};

function normalizePlatform(value) {
  switch (value) {
    case "darwin":
      return "macos";
    case "win32":
      return "windows";
    default:
      return value;
  }
}

async function pathExists(value) {
  try {
    await stat(value);
    return true;
  } catch {
    return false;
  }
}

async function findFiles(dir) {
  const files = [];
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

async function removeStaleArtifacts(dir, platform, arch) {
  if (!(await pathExists(dir))) {
    return;
  }

  const staleEntries = [
    `${platform}-${arch}`,
    `darwin-${arch}`,
  ];
  const prefix = `everr-app-${platform}-${arch}.`;
  const entries = await readdir(dir);

  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(prefix) || staleEntries.includes(entry))
      .map((entry) => rm(path.join(dir, entry), { force: true, recursive: true })),
  );
}

async function findReleaseArtifact(dir, extensions) {
  const candidates = (await findFiles(dir)).filter((file) =>
    extensions.includes(path.extname(file)),
  );

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

const platform = normalizePlatform(getPlatform());
const arch = getArch();
const extensions = artifactMatchers[platform];

if (!extensions) {
  throw new Error(`Unsupported desktop platform: ${platform}`);
}

const bundleDir = await findBundleDir();
const artifact = await findReleaseArtifact(bundleDir, extensions);

if (!artifact) {
  throw new Error(`Could not locate a release artifact for ${platform}-${arch}.`);
}

const destDir = path.join(repoDir, "packages", "docs", "public", "everr-app");
const artifactPath = path.join(
  destDir,
  `everr-app-${platform}-${arch}${path.extname(artifact.file)}`,
);

await mkdir(destDir, { recursive: true });
await removeStaleArtifacts(destDir, platform, arch);
await copyFile(artifact.file, artifactPath);

if (artifact.stat.mode & 0o111) {
  await chmod(artifactPath, 0o755);
}

console.log(`Copied Everr App release artifact to ${artifactPath}`);
