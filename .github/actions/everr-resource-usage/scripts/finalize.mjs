import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = {};

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

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseDate(value, fallback = new Date(0)) {
  const parsed = value ? new Date(value) : fallback;
  return Number.isNaN(parsed.valueOf()) ? fallback : parsed;
}

export function percentile(values, ratio) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

export function buildSummary(samples, metadata) {
  const cpuValues = samples.map((sample) => sample.cpuUtilizationPct);
  const memoryUsedValues = samples.map((sample) => sample.memoryUsedBytes);
  const diskUsedValues = samples.map((sample) => sample.diskUsedBytes);
  const diskUtilizationValues = samples.map((sample) => sample.diskUtilizationPct);
  const loadValues = samples.map((sample) => sample.load1);

  const startedAt = parseDate(metadata.startedAt);
  const completedAt = parseDate(metadata.completedAt, startedAt);
  const durationMs = Math.max(0, completedAt.valueOf() - startedAt.valueOf());

  const average = (values) =>
    values.length === 0
      ? 0
      : values.reduce((sum, value) => sum + value, 0) / values.length;

  return {
    schemaVersion: 1,
    checkRunId: toNumber(metadata.checkRunId),
    repo: metadata.repo,
    runId: toNumber(metadata.runId),
    runAttempt: toNumber(metadata.runAttempt),
    githubJob: metadata.githubJob,
    sampleIntervalSeconds: toNumber(metadata.sampleIntervalSeconds, 5),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    runner: {
      name: metadata.runnerName,
      os: metadata.runnerOs,
      arch: metadata.runnerArch,
    },
    sampleCount: samples.length,
    durationMs,
    cpu: {
      avgPct: average(cpuValues),
      p95Pct: percentile(cpuValues, 0.95),
      maxPct: cpuValues.length === 0 ? 0 : Math.max(...cpuValues),
    },
    memory: {
      avgUsedBytes: average(memoryUsedValues),
      maxUsedBytes: memoryUsedValues.length === 0 ? 0 : Math.max(...memoryUsedValues),
    },
    disk: {
      peakUsedBytes: diskUsedValues.length === 0 ? 0 : Math.max(...diskUsedValues),
      peakUtilizationPct:
        diskUtilizationValues.length === 0 ? 0 : Math.max(...diskUtilizationValues),
    },
    load1: {
      max: loadValues.length === 0 ? 0 : Math.max(...loadValues),
    },
  };
}

export async function loadSamples(samplesPath) {
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
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new Error(`invalid NDJSON sample on line ${index + 1}: ${error.message}`);
      }

      return {
        timestamp: parsed.timestamp,
        cpuUtilizationPct: toNumber(parsed.cpuUtilizationPct),
        memoryUsedBytes: toNumber(parsed.memoryUsedBytes),
        memoryAvailableBytes: toNumber(parsed.memoryAvailableBytes),
        diskUsedBytes: toNumber(parsed.diskUsedBytes),
        diskAvailableBytes: toNumber(parsed.diskAvailableBytes),
        diskUtilizationPct: toNumber(parsed.diskUtilizationPct),
        load1: toNumber(parsed.load1),
      };
    });
}

export async function finalizePartialArtifact({ samplesPath, outputDir, metadata }) {
  const samples = await loadSamples(samplesPath);
  const summary = buildSummary(samples, metadata);

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    `${outputDir}/summary.json`,
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );

  if (samplesPath && existsSync(samplesPath)) {
    await copyFile(samplesPath, `${outputDir}/samples.ndjson`);
  } else {
    await writeFile(`${outputDir}/samples.ndjson`, "", "utf8");
  }

  return summary;
}

async function main() {
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
      sampleIntervalSeconds: args["sample-interval-seconds"],
      runnerName: args["runner-name"] ?? "",
      runnerOs: args["runner-os"] ?? "",
      runnerArch: args["runner-arch"] ?? "",
      startedAt: args["started-at"],
      completedAt: args["completed-at"],
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
