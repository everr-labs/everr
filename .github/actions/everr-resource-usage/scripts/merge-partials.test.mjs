import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { buildCanonicalArtifact } from "./merge-partials.mjs";

test("buildCanonicalArtifact merges partial directories into the canonical artifact", async () => {
  const tempDir = await mkdtemp(`${tmpdir()}/everr-resource-usage-merge-`);

  try {
    const inputDir = `${tempDir}/input`;
    const outputDir = `${tempDir}/output`;

    await mkdir(`${inputDir}/everr-resource-usage-partial-200`, { recursive: true });
    await mkdir(`${inputDir}/everr-resource-usage-partial-100`, { recursive: true });

    await writeFile(
      `${inputDir}/everr-resource-usage-partial-200/summary.json`,
      `${JSON.stringify({ schemaVersion: 1, checkRunId: 200, sampleCount: 2 })}\n`,
      "utf8",
    );
    await writeFile(
      `${inputDir}/everr-resource-usage-partial-200/samples.ndjson`,
      '{"timestamp":"2026-03-10T10:00:00.000Z"}\n',
      "utf8",
    );
    await writeFile(
      `${inputDir}/everr-resource-usage-partial-100/summary.json`,
      `${JSON.stringify({ schemaVersion: 1, checkRunId: 100, sampleCount: 1 })}\n`,
      "utf8",
    );
    await writeFile(
      `${inputDir}/everr-resource-usage-partial-100/samples.ndjson`,
      '{"timestamp":"2026-03-10T10:00:05.000Z"}\n',
      "utf8",
    );

    const manifest = await buildCanonicalArtifact({
      inputDir,
      outputDir,
      repo: "everr-labs/everr",
      runId: "321",
      runAttempt: "7",
      sampleIntervalSeconds: "5",
      generatedAt: "2026-03-10T10:00:30.000Z",
    });

    assert.deepEqual(manifest.jobs.map((job) => job.checkRunId), [100, 200]);
    assert.equal(manifest.runId, 321);
    assert.equal(manifest.runAttempt, 7);

    const savedManifest = JSON.parse(await readFile(`${outputDir}/manifest.json`, "utf8"));
    assert.equal(savedManifest.jobs[0].summaryPath, "jobs/100/summary.json");
    assert.match(await readFile(`${outputDir}/jobs/200/samples.ndjson`, "utf8"), /timestamp/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
