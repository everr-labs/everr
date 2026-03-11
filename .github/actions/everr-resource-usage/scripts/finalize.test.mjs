import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { finalizePartialArtifact } from "./finalize.mjs";

test("finalizePartialArtifact writes summary and copied samples", async () => {
  const tempDir = await mkdtemp(`${tmpdir()}/everr-resource-usage-finalize-`);

  try {
    const samplesPath = `${tempDir}/samples.ndjson`;
    await writeFile(
      samplesPath,
      [
        '{"timestamp":"2026-03-10T10:00:00.000Z","cpuUtilizationPct":10,"memoryUsedBytes":100,"memoryAvailableBytes":900,"diskUsedBytes":500,"diskAvailableBytes":1500,"diskUtilizationPct":25,"load1":0.2}',
        '{"timestamp":"2026-03-10T10:00:05.000Z","cpuUtilizationPct":50,"memoryUsedBytes":300,"memoryAvailableBytes":700,"diskUsedBytes":600,"diskAvailableBytes":1400,"diskUtilizationPct":30,"load1":0.8}',
        '{"timestamp":"2026-03-10T10:00:10.000Z","cpuUtilizationPct":40,"memoryUsedBytes":200,"memoryAvailableBytes":800,"diskUsedBytes":700,"diskAvailableBytes":1300,"diskUtilizationPct":35,"load1":0.6}',
      ].join("\n"),
      "utf8",
    );

    const outputDir = `${tempDir}/partial`;
    const summary = await finalizePartialArtifact({
      samplesPath,
      outputDir,
      metadata: {
        checkRunId: "123",
        repo: "everr-labs/everr",
        runId: "456",
        runAttempt: "2",
        githubJob: "lint",
        sampleIntervalSeconds: "5",
        runnerName: "GitHub Actions 1",
        runnerOs: "Linux",
        runnerArch: "X64",
        startedAt: "2026-03-10T10:00:00.000Z",
        completedAt: "2026-03-10T10:00:15.000Z",
      },
    });

    assert.equal(summary.checkRunId, 123);
    assert.equal(summary.sampleCount, 3);
    assert.equal(summary.durationMs, 15000);
    assert.equal(summary.cpu.avgPct, 100 / 3);
    assert.equal(summary.cpu.p95Pct, 50);
    assert.equal(summary.cpu.maxPct, 50);
    assert.equal(summary.memory.avgUsedBytes, 200);
    assert.equal(summary.memory.maxUsedBytes, 300);
    assert.equal(summary.disk.peakUsedBytes, 700);
    assert.equal(summary.disk.peakUtilizationPct, 35);
    assert.equal(summary.load1.max, 0.8);

    const savedSummary = JSON.parse(
      await readFile(`${outputDir}/summary.json`, "utf8"),
    );
    const savedSamples = await readFile(`${outputDir}/samples.ndjson`, "utf8");

    assert.equal(savedSummary.runner.os, "Linux");
    assert.match(savedSamples, /cpuUtilizationPct/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("finalizePartialArtifact handles missing sample files", async () => {
  const tempDir = await mkdtemp(`${tmpdir()}/everr-resource-usage-finalize-empty-`);

  try {
    const outputDir = `${tempDir}/partial`;
    const summary = await finalizePartialArtifact({
      samplesPath: `${tempDir}/missing.ndjson`,
      outputDir,
      metadata: {
        checkRunId: "999",
        repo: "everr-labs/everr",
        runId: "111",
        runAttempt: "1",
        githubJob: "build",
        sampleIntervalSeconds: "5",
        runnerName: "",
        runnerOs: "Linux",
        runnerArch: "X64",
        startedAt: "2026-03-10T10:00:00.000Z",
        completedAt: "2026-03-10T10:00:05.000Z",
      },
    });

    assert.equal(summary.sampleCount, 0);
    assert.equal(summary.durationMs, 5000);
    assert.equal(summary.cpu.maxPct, 0);
    assert.equal(await readFile(`${outputDir}/samples.ndjson`, "utf8"), "");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
