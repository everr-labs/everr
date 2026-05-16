import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  artifactNameForCheckRun,
  buildRuntimePaths,
  finalizeAndUploadResourceUsage,
  normalizeCheckRunId,
  resolveActionRoot,
  resolveCheckRunIdInput,
  startResourceUsage,
} from "./index.ts";

test("artifactNameForCheckRun uses the direct per-job naming contract", () => {
  assert.equal(artifactNameForCheckRun("123"), "everr-resource-usage-v2-123");
});

test("buildRuntimePaths keeps job-scoped files under RUNNER_TEMP", () => {
  const paths = buildRuntimePaths({
    RUNNER_TEMP: "/tmp/runner",
    GITHUB_RUN_ID: "12",
    GITHUB_RUN_ATTEMPT: "3",
    GITHUB_JOB: "lint",
  });

  assert.equal(paths.baseDir, "/tmp/runner/everr-resource-usage/12-3-lint");
  assert.equal(
    paths.outputDir,
    "/tmp/runner/everr-resource-usage/12-3-lint/artifact",
  );
});

test("resolveActionRoot derives the action directory from the entrypoint path", () => {
  assert.equal(
    resolveActionRoot(fileURLToPath(import.meta.url)),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  );
});

test("normalizeCheckRunId trims valid ids and rejects malformed values", () => {
  assert.equal(normalizeCheckRunId(" 123 "), "123");
  assert.equal(normalizeCheckRunId(""), null);
  assert.equal(normalizeCheckRunId("0"), null);
  assert.equal(normalizeCheckRunId("001"), null);
  assert.equal(normalizeCheckRunId("abc"), null);
});

test("resolveCheckRunIdInput warns when the workflow does not provide a valid id", () => {
  const warnings: string[] = [];

  const checkRunId = resolveCheckRunIdInput({
    getInput: () => "not-a-number",
    warning: (message: string) => warnings.push(message),
  });

  assert.equal(checkRunId, null);
  assert.match(warnings[0], /missing or invalid check-run-id input/);
});

test("startResourceUsage no-ops on non-linux runners", async () => {
  const savedState = new Map<string, string>();
  const infoMessages: string[] = [];

  const result = await startResourceUsage({
    env: {
      RUNNER_OS: "Windows",
    },
    getInput: () => "123",
    saveState: (key: string, value: string) => savedState.set(key, value),
    info: (message: string) => infoMessages.push(message),
    warning: () => {},
  });

  assert.equal(result.enabled, false);
  assert.equal(savedState.get("enabled"), "0");
  assert.match(infoMessages[0], /supported only on Linux runners/);
});

test("startResourceUsage skips sampling when check-run-id is missing", async () => {
  const savedState = new Map<string, string>();
  const warnings: string[] = [];

  const result = await startResourceUsage({
    env: {
      RUNNER_OS: "Linux",
    },
    getInput: () => "",
    saveState: (key: string, value: string) => savedState.set(key, value),
    info: () => {},
    warning: (message: string) => warnings.push(message),
  });

  assert.equal(result.enabled, false);
  assert.equal(savedState.get("enabled"), "0");
  assert.match(warnings[0], /missing or invalid check-run-id input/);
});

test("startResourceUsage downgrades sampler startup failures to warnings", async () => {
  const savedState = new Map<string, string>();
  const warnings: string[] = [];
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "everr-ru-start-"));

  try {
    const result = await startResourceUsage({
      env: {
        RUNNER_OS: "Linux",
        RUNNER_TEMP: tempDir,
        GITHUB_RUN_ID: "12",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_JOB: "lint",
        GITHUB_REPOSITORY: "everr-labs/everr",
        GITHUB_WORKSPACE: tempDir,
      },
      getInput: () => "111",
      saveState: (key: string, value: string) => savedState.set(key, value),
      warning: (message: string) => warnings.push(message),
      spawnImpl: () => {
        throw new Error("spawn failed");
      },
    });

    assert.equal(result.enabled, false);
    assert.equal(result.checkRunId, "111");
    assert.equal(savedState.get("enabled"), "0");
    assert.match(warnings[0], /did not start: spawn failed/);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("startResourceUsage resolves sampler path without GITHUB_ACTION_PATH", async () => {
  const savedState = new Map<string, string>();
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "everr-ru-spawn-"));
  let spawnInvocation:
    | {
        args: readonly string[];
        file: string;
      }
    | undefined;

  try {
    const result = await startResourceUsage({
      env: {
        RUNNER_OS: "Linux",
        RUNNER_TEMP: tempDir,
        GITHUB_RUN_ID: "12",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_JOB: "lint",
        GITHUB_REPOSITORY: "everr-labs/everr",
        GITHUB_WORKSPACE: tempDir,
      },
      getInput: () => "222",
      saveState: (key: string, value: string) => savedState.set(key, value),
      info: () => {},
      warning: () => {},
      spawnImpl: ((file: string, args: readonly string[]) => {
        spawnInvocation = { file, args };
        return {
          pid: 321,
          unref() {},
        } as any;
      }) as typeof import("node:child_process").spawn,
    });

    assert.equal(result.enabled, true);
    assert.equal(result.checkRunId, "222");
    assert.equal(spawnInvocation?.file, "bash");
    assert.equal(
      spawnInvocation?.args[0],
      path.join(resolveActionRoot(fileURLToPath(import.meta.url)), "scripts", "sampler.sh"),
    );
    assert.equal(savedState.get("checkRunId"), "222");
    assert.equal(savedState.get("actionPath"), undefined);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("finalizeAndUploadResourceUsage uploads the per-job artifact", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "everr-ru-finalize-"));
  const outputDir = path.join(
    tempDir,
    "everr-resource-usage",
    "123-1-lint",
    "artifact",
  );
  const uploaded: Array<{
    files: string[];
    name: string;
    options: { retentionDays: number };
    rootDirectory: string;
  }> = [];
  const infos: string[] = [];
  let execInvocation:
    | {
        args: readonly string[];
        file: string;
      }
    | undefined;

  try {
    const result = await finalizeAndUploadResourceUsage({
      env: {
        RUNNER_TEMP: tempDir,
        GITHUB_RUN_ID: "123",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_JOB: "lint",
        GITHUB_REPOSITORY: "everr-labs/everr",
        RUNNER_OS: "Linux",
        RUNNER_ARCH: "X64",
        RUNNER_NAME: "GitHub Actions 1",
      },
      readState: (key: string) =>
        (
          {
            enabled: "1",
            checkRunId: "777",
            samplesPath: path.join(tempDir, "samples.ndjson"),
            pidPath: path.join(tempDir, "missing.pid"),
            startedAt: "2026-03-10T10:00:00.000Z",
          } as Record<string, string>
        )[key] || "",
      execFileImpl: async (file: string, args: readonly string[]) => {
        execInvocation = { file, args };
        await fsp.mkdir(outputDir, { recursive: true });
        await fsp.writeFile(path.join(outputDir, "metadata.json"), "{}\n", "utf8");
        await fsp.writeFile(path.join(outputDir, "samples.ndjson"), "", "utf8");
      },
      resolveFilesystemInfo: async () => ({
        device: "/dev/root",
        mountpoint: "/",
        type: "ext4",
      }),
      uploadArtifactImpl: async (
        name: string,
        files: string[],
        rootDirectory: string,
        options: { retentionDays: number },
      ) => {
        uploaded.push({ name, files, rootDirectory, options });
      },
      info: (message: string) => infos.push(message),
      warning: () => {},
    });

    assert.equal(result.artifactName, "everr-resource-usage-v2-777");
    assert.deepEqual(uploaded[0], {
      name: "everr-resource-usage-v2-777",
      files: [
        path.join(outputDir, "metadata.json"),
        path.join(outputDir, "samples.ndjson"),
      ],
      rootDirectory: outputDir,
      options: { retentionDays: 7 },
    });
    assert.equal(execInvocation?.file, process.execPath);
    assert.equal(
      execInvocation?.args[0],
      path.join(
        resolveActionRoot(fileURLToPath(import.meta.url)),
        "dist",
        "finalize",
        "index.js",
      ),
    );
    assert.match(infos[0], /uploaded resource-usage artifact/);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test(
  "finalizeAndUploadResourceUsage downgrades finalize failures to warnings",
  async () => {
    const warnings: string[] = [];

    const result = await finalizeAndUploadResourceUsage({
      env: {
        RUNNER_TEMP: os.tmpdir(),
        GITHUB_RUN_ID: "123",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_JOB: "lint",
      },
      readState: (key: string) =>
        (
          {
            enabled: "1",
            checkRunId: "777",
            samplesPath: path.join(os.tmpdir(), "missing.ndjson"),
            pidPath: path.join(os.tmpdir(), "missing.pid"),
            startedAt: "2026-03-10T10:00:00.000Z",
          } as Record<string, string>
        )[key] || "",
      execFileImpl: async () => {
        throw new Error("finalize boom");
      },
      resolveFilesystemInfo: async () => ({
        device: "/dev/root",
        mountpoint: "/",
        type: "ext4",
      }),
      uploadArtifactImpl: async () => {},
      info: () => {},
      warning: (message: string) => warnings.push(message),
    });

    assert.equal(result.failed, true);
    assert.match(warnings[0], /finalization failed: finalize boom/);
  },
);
