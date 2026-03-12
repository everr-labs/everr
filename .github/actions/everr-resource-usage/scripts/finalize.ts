import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

interface PartialArtifactMetadata {
  checkRunId?: string;
  completedAt?: string;
  filesystemDevice?: string;
  filesystemMountpoint?: string;
  filesystemType?: string;
  githubJob?: string;
  repo?: string;
  runAttempt?: string;
  runId?: string;
  runnerArch?: string;
  runnerName?: string;
  runnerOs?: string;
  startedAt?: string;
}

interface ResourceUsageMetadata {
  checkRunId: number;
  completedAt: string;
  filesystem: {
    device: string;
    mountpoint: string;
    type: string;
  };
  githubJob?: string;
  repo?: string;
  runAttempt: number;
  runId: number;
  runner: {
    arch: string;
    name: string;
    os: string;
  };
  schemaVersion: number;
  startedAt: string;
}

interface ResourceUsageSample {
  cpu: {
    logical: Array<{
      logicalNumber: number;
      utilization: number;
    }>;
  };
  filesystem: {
    device: string;
    freeBytes: number;
    limitBytes: number;
    mountpoint: string;
    type: string;
    usedBytes: number;
    utilization: number;
  };
  memory: {
    availableBytes: number;
    limitBytes: number;
    usedBytes: number;
    utilization: number;
  };
  network: {
    interfaces: Array<{
      name: string;
      receiveBytes: number;
      transmitBytes: number;
    }>;
  };
  timestamp: string;
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const args: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInteger(value: unknown, fallback = 0): number {
  const parsed = Math.trunc(toNumber(value, fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function parseDate(value: string | undefined, fallback = new Date(0)): Date {
  const parsed = value ? new Date(value) : fallback;
  return Number.isNaN(parsed.valueOf()) ? fallback : parsed;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function buildMetadata(
  metadata: PartialArtifactMetadata,
): ResourceUsageMetadata {
  const startedAt = parseDate(metadata.startedAt);
  const completedAt = parseDate(metadata.completedAt, startedAt);

  return {
    schemaVersion: 2,
    checkRunId: toInteger(metadata.checkRunId),
    repo: metadata.repo,
    runId: toInteger(metadata.runId),
    runAttempt: toInteger(metadata.runAttempt),
    githubJob: metadata.githubJob,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    runner: {
      name: metadata.runnerName ?? "",
      os: metadata.runnerOs ?? "",
      arch: metadata.runnerArch ?? "",
    },
    filesystem: {
      device: metadata.filesystemDevice ?? "",
      mountpoint: metadata.filesystemMountpoint ?? "",
      type: metadata.filesystemType ?? "",
    },
  };
}

function parseCPULogicalSamples(
  value: unknown,
): Array<{ logicalNumber: number; utilization: number }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      logicalNumber: toInteger(
        item && typeof item === "object"
          ? (item as Record<string, unknown>).logicalNumber
          : undefined,
      ),
      utilization: toNumber(
        item && typeof item === "object"
          ? (item as Record<string, unknown>).utilization
          : undefined,
      ),
    }))
    .sort((left, right) => left.logicalNumber - right.logicalNumber);
}

function parseNetworkInterfaces(
  value: unknown,
): Array<{ name: string; receiveBytes: number; transmitBytes: number }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      name: toString(
        item && typeof item === "object"
          ? (item as Record<string, unknown>).name
          : undefined,
      ),
      receiveBytes: toNumber(
        item && typeof item === "object"
          ? (item as Record<string, unknown>).receiveBytes
          : undefined,
      ),
      transmitBytes: toNumber(
        item && typeof item === "object"
          ? (item as Record<string, unknown>).transmitBytes
          : undefined,
      ),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function sanitizeSample(
  parsed: Record<string, unknown>,
): ResourceUsageSample {
  const cpu =
    parsed.cpu && typeof parsed.cpu === "object"
      ? (parsed.cpu as Record<string, unknown>)
      : {};
  const memory =
    parsed.memory && typeof parsed.memory === "object"
      ? (parsed.memory as Record<string, unknown>)
      : {};
  const filesystem =
    parsed.filesystem && typeof parsed.filesystem === "object"
      ? (parsed.filesystem as Record<string, unknown>)
      : {};
  const network =
    parsed.network && typeof parsed.network === "object"
      ? (parsed.network as Record<string, unknown>)
      : {};

  return {
    timestamp: toString(parsed.timestamp),
    cpu: {
      logical: parseCPULogicalSamples(cpu.logical),
    },
    memory: {
      limitBytes: toNumber(memory.limitBytes),
      usedBytes: toNumber(memory.usedBytes),
      availableBytes: toNumber(memory.availableBytes),
      utilization: toNumber(memory.utilization),
    },
    filesystem: {
      device: toString(filesystem.device),
      mountpoint: toString(filesystem.mountpoint),
      type: toString(filesystem.type),
      limitBytes: toNumber(filesystem.limitBytes),
      usedBytes: toNumber(filesystem.usedBytes),
      freeBytes: toNumber(filesystem.freeBytes),
      utilization: toNumber(filesystem.utilization),
    },
    network: {
      interfaces: parseNetworkInterfaces(network.interfaces),
    },
  };
}

export async function loadSamples(
  samplesPath: string | undefined,
): Promise<ResourceUsageSample[]> {
  if (!samplesPath || !existsSync(samplesPath)) {
    return [];
  }

  const raw = await readFile(samplesPath, "utf8");
  if (raw.trim() === "") {
    return [];
  }

  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch (error) {
        throw new Error(
          `invalid NDJSON sample on line ${index + 1}: ${formatError(error)}`,
        );
      }

      return sanitizeSample(parsed);
    });
}

function serializeSamples(samples: ResourceUsageSample[]): string {
  if (samples.length === 0) {
    return "";
  }

  return `${samples.map((sample) => JSON.stringify(sample)).join("\n")}\n`;
}

export async function finalizePartialArtifact({
  samplesPath,
  outputDir,
  metadata,
}: {
  metadata: PartialArtifactMetadata;
  outputDir: string;
  samplesPath?: string;
}) {
  const samples = await loadSamples(samplesPath);
  const finalizedMetadata = buildMetadata(metadata);

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    `${outputDir}/metadata.json`,
    `${JSON.stringify(finalizedMetadata, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    `${outputDir}/samples.ndjson`,
    serializeSamples(samples),
    "utf8",
  );

  return finalizedMetadata;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  await finalizePartialArtifact({
    samplesPath: args["samples-path"],
    outputDir: args["output-dir"],
    metadata: {
      checkRunId: args["check-run-id"],
      repo: args.repo,
      runId: args["run-id"],
      runAttempt: args["run-attempt"],
      githubJob: args["github-job"],
      runnerName: args["runner-name"] ?? "",
      runnerOs: args["runner-os"] ?? "",
      runnerArch: args["runner-arch"] ?? "",
      startedAt: args["started-at"],
      completedAt: args["completed-at"],
      filesystemDevice: args["filesystem-device"] ?? "",
      filesystemMountpoint: args["filesystem-mountpoint"] ?? "",
      filesystemType: args["filesystem-type"] ?? "",
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(formatError(error));
    process.exitCode = 1;
  });
}
