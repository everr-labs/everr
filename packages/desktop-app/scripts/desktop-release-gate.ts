import { execFile as execFileCallback } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const DESKTOP_PACKAGE_NAME = "@everr/desktop-app";
const ZERO_SHA = /^0{40}$/;

export type DeletedChangeset = {
  path: string;
  contents: string;
};

export type DesktopReleaseGateInput = {
  deletedChangesets: DeletedChangeset[];
  packageVersion: string;
  tauriVersion: string;
  cargoVersion: string;
};

export type DesktopReleaseGateResult =
  | {
      shouldRelease: true;
      version: string;
      artifactName: string;
      reason: string;
    }
  | {
      shouldRelease: false;
      reason: string;
    };

function normalizeDesktopVersion(version: string) {
  const trimmed = version.trim();
  if (
    !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      trimmed,
    )
  ) {
    throw new Error(`Unsupported desktop app version "${version}". Expected X.Y.Z.`);
  }

  return trimmed;
}

function changesetFrontmatter(contents: string) {
  const lines = contents.trimStart().split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return "";
  }

  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end === -1) {
    return "";
  }

  return lines.slice(1, end).join("\n");
}

export function targetsDesktopPackage(contents: string) {
  return /^['"]?@everr\/desktop-app['"]?\s*:/m.test(changesetFrontmatter(contents));
}

export function parseCargoPackageVersion(contents: string) {
  const lines = contents.split(/\r?\n/);
  let inPackageSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inPackageSection = trimmed === "[package]";
      continue;
    }

    if (inPackageSection) {
      const match = /^\s*version\s*=\s*"([^"]+)"\s*$/.exec(line);
      if (match) {
        return match[1];
      }
    }
  }

  throw new Error("Could not find [package].version in Cargo.toml.");
}

export function evaluateDesktopReleaseGate(
  input: DesktopReleaseGateInput,
): DesktopReleaseGateResult {
  const desktopChangeset = input.deletedChangesets.find((changeset) =>
    targetsDesktopPackage(changeset.contents),
  );

  if (!desktopChangeset) {
    return {
      shouldRelease: false,
      reason: `No deleted changeset targets ${DESKTOP_PACKAGE_NAME}.`,
    };
  }

  const packageVersion = normalizeDesktopVersion(input.packageVersion);
  const tauriVersion = normalizeDesktopVersion(input.tauriVersion);
  const cargoVersion = normalizeDesktopVersion(input.cargoVersion);

  if (packageVersion !== tauriVersion || packageVersion !== cargoVersion) {
    throw new Error(
      `Desktop release versions must match: package.json=${packageVersion}, tauri.conf.json=${tauriVersion}, Cargo.toml=${cargoVersion}.`,
    );
  }

  return {
    shouldRelease: true,
    version: packageVersion,
    artifactName: `everr-desktop-release-${packageVersion}`,
    reason: `Deleted changeset ${desktopChangeset.path} targets ${DESKTOP_PACKAGE_NAME}.`,
  };
}

function parseArgs(args: string[]) {
  let base: string | undefined;
  let head: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base") {
      base = args[++index];
      continue;
    }
    if (arg === "--head") {
      head = args[++index];
      continue;
    }
    throw new Error(`Unsupported argument: ${arg}`);
  }

  if (!base || !head) {
    throw new Error("Usage: desktop-release-gate.ts --base <sha> --head <sha>");
  }

  return { base, head };
}

async function git(args: string[], cwd: string) {
  const result = await execFile("git", args, {
    cwd,
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trimEnd();
}

async function listDeletedChangesets({
  base,
  head,
  cwd,
}: {
  base: string;
  head: string;
  cwd: string;
}) {
  if (ZERO_SHA.test(base)) {
    return [];
  }

  const stdout = await git(
    ["diff", "--name-status", "--diff-filter=D", base, head, "--", ".changeset"],
    cwd,
  );

  return stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter(([status, filename]) => status === "D" && filename?.endsWith(".md"))
    .map(([, filename]) => filename);
}

async function readDeletedChangesets({
  base,
  paths,
  cwd,
}: {
  base: string;
  paths: string[];
  cwd: string;
}): Promise<DeletedChangeset[]> {
  return Promise.all(
    paths.map(async (changesetPath) => ({
      path: changesetPath,
      contents: await git(["show", `${base}:${changesetPath}`], cwd),
    })),
  );
}

async function readDesktopVersions(cwd: string) {
  const packageJsonPath = path.join(cwd, "packages", "desktop-app", "package.json");
  const tauriConfigPath = path.join(
    cwd,
    "packages",
    "desktop-app",
    "src-tauri",
    "tauri.conf.json",
  );
  const cargoTomlPath = path.join(
    cwd,
    "packages",
    "desktop-app",
    "src-tauri",
    "Cargo.toml",
  );

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    version?: string;
  };
  const tauriConfig = JSON.parse(await readFile(tauriConfigPath, "utf8")) as {
    version?: string;
  };
  const cargoToml = await readFile(cargoTomlPath, "utf8");

  if (!packageJson.version) {
    throw new Error(`Could not find version in ${packageJsonPath}.`);
  }
  if (!tauriConfig.version) {
    throw new Error(`Could not find version in ${tauriConfigPath}.`);
  }

  return {
    packageVersion: packageJson.version,
    tauriVersion: tauriConfig.version,
    cargoVersion: parseCargoPackageVersion(cargoToml),
  };
}

async function writeOutputs(
  result: DesktopReleaseGateResult,
  outputPath = process.env.GITHUB_OUTPUT,
) {
  const outputs = [`should_release=${result.shouldRelease ? "true" : "false"}`];
  if (result.shouldRelease) {
    outputs.push(`version=${result.version}`);
    outputs.push(`artifact_name=${result.artifactName}`);
  }

  if (outputPath) {
    await appendFile(outputPath, `${outputs.join("\n")}\n`);
  } else {
    console.log(outputs.join("\n"));
  }
}

export async function runDesktopReleaseGate(
  args = process.argv.slice(2),
  cwd = process.cwd(),
) {
  const { base, head } = parseArgs(args);
  const paths = await listDeletedChangesets({ base, head, cwd });
  const deletedChangesets = await readDeletedChangesets({ base, paths, cwd });
  const versions = await readDesktopVersions(cwd);
  const result = evaluateDesktopReleaseGate({
    deletedChangesets,
    ...versions,
  });

  console.log(result.reason);
  await writeOutputs(result);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runDesktopReleaseGate();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
