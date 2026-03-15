import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "zx";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

export const packageDir = path.resolve(scriptDir, "..");
export const repoDir = path.resolve(packageDir, "..", "..");
export const cliDir = path.join(packageDir, "src-cli");
export const docsPublicDir = path.join(repoDir, "packages", "docs", "public");
export const envFile = path.join(packageDir, ".env");

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

function getFlagEnv(name: string): "0" | "1" | undefined {
  const value = getEnv(name);
  if (value === undefined) {
    return undefined;
  }

  if (value === "0" || value === "1") {
    return value;
  }

  throw new Error(`${name} must be "0" or "1" when set.`);
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

  if (getFlagEnv("EVERR_ALLOW_UNSIGNED_MACOS_BUILD") === "1") {
    console.error(
      `Skipping signing for ${binaryPath} because EVERR_ALLOW_UNSIGNED_MACOS_BUILD=1.`,
    );
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

export async function installCliBinary(sourceBin: string) {
  const installPath = path.join(process.env.HOME ?? "", ".local", "bin", "everr");

  await mkdir(path.dirname(installPath), { recursive: true });
  await copyFile(sourceBin, installPath);
  await chmod(installPath, 0o755);

  console.log(`Installed Everr CLI to ${installPath}`);

  return installPath;
}
