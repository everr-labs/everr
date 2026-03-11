import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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

async function readSummary(summaryPath) {
  const raw = await readFile(summaryPath, "utf8");
  const parsed = JSON.parse(raw);

  if (parsed.schemaVersion !== 1) {
    throw new Error(`unsupported schemaVersion in ${summaryPath}`);
  }

  const checkRunId = toNumber(parsed.checkRunId);
  if (checkRunId <= 0) {
    throw new Error(`invalid checkRunId in ${summaryPath}`);
  }

  return parsed;
}

export async function buildCanonicalArtifact({
  inputDir,
  outputDir,
  repo,
  runId,
  runAttempt,
  sampleIntervalSeconds,
  generatedAt = new Date().toISOString(),
}) {
  await mkdir(outputDir, { recursive: true });

  const jobs = [];
  const seenCheckRunIds = new Set();

  if (inputDir && existsSync(inputDir)) {
    const artifactDirs = (await readdir(inputDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const artifactDirName of artifactDirs) {
      const partialDir = `${inputDir}/${artifactDirName}`;
      const summary = await readSummary(`${partialDir}/summary.json`);
      const checkRunId = toNumber(summary.checkRunId);

      if (seenCheckRunIds.has(checkRunId)) {
        throw new Error(`duplicate checkRunId ${checkRunId} across partial artifacts`);
      }
      seenCheckRunIds.add(checkRunId);

      const jobDir = `${outputDir}/jobs/${checkRunId}`;
      await mkdir(jobDir, { recursive: true });
      await copyFile(`${partialDir}/summary.json`, `${jobDir}/summary.json`);

      if (existsSync(`${partialDir}/samples.ndjson`)) {
        await copyFile(`${partialDir}/samples.ndjson`, `${jobDir}/samples.ndjson`);
      } else {
        await writeFile(`${jobDir}/samples.ndjson`, "", "utf8");
      }

      jobs.push({
        checkRunId,
        sampleCount: toNumber(summary.sampleCount),
        summaryPath: `jobs/${checkRunId}/summary.json`,
        samplesPath: `jobs/${checkRunId}/samples.ndjson`,
      });
    }
  }

  jobs.sort((left, right) => left.checkRunId - right.checkRunId);

  const manifest = {
    schemaVersion: 1,
    repo,
    runId: toNumber(runId),
    runAttempt: toNumber(runAttempt),
    sampleIntervalSeconds: toNumber(sampleIntervalSeconds, 5),
    generatedAt,
    jobs,
  };

  await writeFile(
    `${outputDir}/manifest.json`,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return manifest;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await buildCanonicalArtifact({
    inputDir: args["input-dir"],
    outputDir: args["output-dir"],
    repo: args.repo,
    runId: args["run-id"],
    runAttempt: args["run-attempt"],
    sampleIntervalSeconds: args["sample-interval-seconds"],
    generatedAt: args["generated-at"],
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
