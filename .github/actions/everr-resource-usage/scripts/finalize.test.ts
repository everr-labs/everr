import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";

import { finalizePartialArtifact, loadSamples } from "./finalize.ts";

test("finalizePartialArtifact writes metadata and sanitized samples", async () => {
  const tempDir = await mkdtemp(`${tmpdir()}/everr-resource-usage-finalize-`);

  try {
    const samplesPath = `${tempDir}/samples.ndjson`;
    await writeFile(
      samplesPath,
      [
        JSON.stringify({
          timestamp: "2026-03-10T10:00:00.000Z",
          cpu: {
            logical: [
              { logicalNumber: 2, utilization: 0.4 },
              { logicalNumber: 0, utilization: 0.1 },
            ],
          },
          memory: {
            limitBytes: 1000,
            usedBytes: 250,
            availableBytes: 750,
            utilization: 0.25,
          },
          filesystem: {
            device: "/dev/root",
            mountpoint: "/",
            type: "ext4",
            limitBytes: 2000,
            usedBytes: 400,
            freeBytes: 1600,
            utilization: 0.2,
          },
          network: {
            interfaces: [
              { name: "eth1", receiveBytes: 99, transmitBytes: 22 },
              { name: "eth0", receiveBytes: 12, transmitBytes: 34 },
            ],
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const outputDir = `${tempDir}/partial`;
    const metadata = await finalizePartialArtifact({
      samplesPath,
      outputDir,
      metadata: {
        checkRunId: "123",
        repo: "everr-labs/everr",
        runId: "456",
        runAttempt: "2",
        githubJob: "lint",
        runnerName: "GitHub Actions 1",
        runnerOs: "Linux",
        runnerArch: "X64",
        startedAt: "2026-03-10T10:00:00.000Z",
        completedAt: "2026-03-10T10:00:15.000Z",
        filesystemDevice: "/dev/root",
        filesystemMountpoint: "/",
        filesystemType: "ext4",
      },
    });

    assert.equal(metadata.schemaVersion, 2);
    assert.equal(metadata.checkRunId, 123);
    assert.equal(metadata.filesystem.mountpoint, "/");

    const savedMetadata = JSON.parse(
      await readFile(`${outputDir}/metadata.json`, "utf8"),
    );
    const savedSamples = await readFile(`${outputDir}/samples.ndjson`, "utf8");
    const parsedSamples = await loadSamples(`${outputDir}/samples.ndjson`);

    assert.equal(savedMetadata.runner.os, "Linux");
    assert.equal(savedMetadata.sampleIntervalSeconds, undefined);
    assert.match(savedSamples, /"network"/);
    assert.deepEqual(parsedSamples[0].cpu.logical.map((sample) => sample.logicalNumber), [
      0, 2,
    ]);
    assert.deepEqual(parsedSamples[0].network.interfaces.map((sample) => sample.name), [
      "eth0", "eth1",
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("finalizePartialArtifact handles missing sample files", async () => {
  const tempDir = await mkdtemp(
    `${tmpdir()}/everr-resource-usage-finalize-empty-`,
  );

  try {
    const outputDir = `${tempDir}/partial`;
    const metadata = await finalizePartialArtifact({
      samplesPath: `${tempDir}/missing.ndjson`,
      outputDir,
      metadata: {
        checkRunId: "999",
        repo: "everr-labs/everr",
        runId: "111",
        runAttempt: "1",
        githubJob: "build",
        runnerName: "",
        runnerOs: "Linux",
        runnerArch: "X64",
        startedAt: "2026-03-10T10:00:00.000Z",
        completedAt: "2026-03-10T10:00:05.000Z",
        filesystemDevice: "/dev/root",
        filesystemMountpoint: "/",
        filesystemType: "ext4",
      },
    });

    assert.equal(metadata.schemaVersion, 2);
    assert.equal(await readFile(`${outputDir}/samples.ndjson`, "utf8"), "");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("finalizePartialArtifact rejects malformed samples with line numbers", async () => {
  const tempDir = await mkdtemp(
    `${tmpdir()}/everr-resource-usage-finalize-malformed-`,
  );

  try {
    const samplesPath = `${tempDir}/samples.ndjson`;
    await writeFile(samplesPath, `{"timestamp":"2026-03-10T10:00:00.000Z"}\nnot-json`, "utf8");

    await assert.rejects(
      finalizePartialArtifact({
        samplesPath,
        outputDir: `${tempDir}/partial`,
        metadata: {
          checkRunId: "1",
          startedAt: "2026-03-10T10:00:00.000Z",
          completedAt: "2026-03-10T10:00:01.000Z",
        },
      }),
      /invalid NDJSON sample on line 2/,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
