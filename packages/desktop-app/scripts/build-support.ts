import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inc as incrementVersion } from "semver";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
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

export async function publishCliArtifact(sourceBin: string) {
  loadBuildEnvFile();

  const outputBin = path.join(docsPublicDir, "everr");
  const outputSha = path.join(docsPublicDir, "everr.sha256");

  await mkdir(docsPublicDir, { recursive: true });
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

export function bumpVersion(version: string, increment: "patch" | "minor" | "major") {
  const nextVersion = incrementVersion(version.trim(), increment);
  if (!nextVersion) {
    throw new Error(
      `Unsupported desktop app version "${version}". Expected a semantic version in the form X.Y.Z.`,
    );
  }

  return nextVersion;
}

type CargoManifest = {
  package?: {
    version?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function replaceCargoPackageVersion(cargoToml: string, version: string) {
  const cargoManifest = parseToml(cargoToml) as CargoManifest;
  if (!cargoManifest.package) {
    throw new Error("Could not update desktop app version in Cargo.toml.");
  }

  cargoManifest.package.version = version;
  return stringifyToml(cargoManifest);
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

async function readJsonFile<T>(pathname: string): Promise<T> {
  return JSON.parse(await readFile(pathname, "utf8")) as T;
}

export async function bumpDesktopAppVersion(
  increment: "patch" | "minor" | "major",
) {
  const paths: DesktopVersionPaths = defaultDesktopVersionPaths;
  const [packageJson, tauriConfig, tauriCargoToml] = await Promise.all([
    readDesktopVersionJson(paths.packageJsonPath),
    readJsonFile<VersionedJsonFile>(paths.tauriConfigPath),
    readFile(paths.tauriCargoTomlPath, "utf8"),
  ]);

  const currentVersion = packageJson.version;
  const nextVersion = bumpVersion(currentVersion, increment);

  packageJson.version = nextVersion;
  tauriConfig.version = nextVersion;

  await Promise.all([
    writeFile(paths.packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`),
    writeFile(paths.tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`),
    writeFile(
      paths.tauriCargoTomlPath,
      replaceCargoPackageVersion(tauriCargoToml, nextVersion),
    ),
  ]);

  return {
    previousVersion: currentVersion,
    nextVersion,
  };
}
