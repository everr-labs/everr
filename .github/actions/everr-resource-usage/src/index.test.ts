import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  artifactNameForCheckRun,
  buildRuntimePaths,
  discoverCheckRunId,
  finalizeAndUploadResourceUsage,
  parseCheckRunId,
  resolveActionRoot,
  resolveWorkflowJobName,
  selectCheckRunId,
  startResourceUsage,
  workflowPathFromRef,
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

test("workflowPathFromRef extracts the local workflow path", () => {
  assert.equal(
    workflowPathFromRef(
      "everr-labs/everr/.github/workflows/build-and-test-collector.yml@refs/heads/main",
    ),
    ".github/workflows/build-and-test-collector.yml",
  );
});

test("parseCheckRunId reads the numeric id from a check run URL", () => {
  assert.equal(
    parseCheckRunId("https://api.github.com/repos/everr-labs/everr/check-runs/123"),
    123,
  );
  assert.equal(
    parseCheckRunId("https://api.github.com/repos/everr-labs/everr/check-runs/not-a-number"),
    null,
  );
});

test(
  "resolveWorkflowJobName reads the declared workflow job name from the local workflow file",
  async () => {
    const tempDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), "everr-ru-workflow-"),
    );

    try {
      const workflowDir = path.join(tempDir, ".github", "workflows");
      await fsp.mkdir(workflowDir, { recursive: true });
      await fsp.writeFile(
        path.join(workflowDir, "build.yml"),
        [
          "name: Build & Test Collector",
          "jobs:",
          "  lint:",
          "    name: Lint",
          "    runs-on: ubuntu-latest",
          "    steps: []",
        ].join("\n"),
        "utf8",
      );

      const name = await resolveWorkflowJobName({
        env: {
          GITHUB_WORKSPACE: tempDir,
          GITHUB_WORKFLOW_REF:
            "everr-labs/everr/.github/workflows/build.yml@refs/heads/main",
          GITHUB_WORKFLOW: "Build & Test Collector",
          GITHUB_JOB: "lint",
        },
        readFile: (filePath: string, encoding: "utf8") =>
          fsp.readFile(filePath, encoding),
        readdir: (directoryPath: string, options: { withFileTypes: true }) =>
          fsp.readdir(directoryPath, options),
      });

      assert.equal(name, "Lint");
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  },
);

test("selectCheckRunId prefers runner and job-name matches", () => {
  const checkRunId = selectCheckRunId({
    jobs: [
      {
        name: "Lint",
        status: "in_progress",
        runner_name: "GitHub Actions 2",
        started_at: "2026-03-10T10:00:00.000Z",
        check_run_url: "https://api.github.com/repos/everr-labs/everr/check-runs/200",
      },
      {
        name: "Lint",
        status: "in_progress",
        runner_name: "GitHub Actions 1",
        started_at: "2026-03-10T10:00:01.000Z",
        check_run_url: "https://api.github.com/repos/everr-labs/everr/check-runs/100",
      },
    ],
    hints: ["Lint", "lint"],
    runnerName: "GitHub Actions 1",
    now: () => new Date("2026-03-10T10:00:02.000Z"),
  });

  assert.equal(checkRunId, 100);
});

test(
  "discoverCheckRunId resolves the current job through the workflow jobs API",
  async () => {
    const tempDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), "everr-ru-discover-"),
    );
    const infoMessages: string[] = [];

    try {
      const workflowDir = path.join(tempDir, ".github", "workflows");
      await fsp.mkdir(workflowDir, { recursive: true });
      await fsp.writeFile(
        path.join(workflowDir, "build.yml"),
        [
          "name: Build & Test Collector",
          "jobs:",
          "  lint:",
          "    name: Lint",
          "    runs-on: ubuntu-latest",
          "    steps: []",
        ].join("\n"),
        "utf8",
      );

      const checkRunId = await discoverCheckRunId({
        env: {
          GITHUB_API_URL: "https://api.github.com",
          GITHUB_WORKSPACE: tempDir,
          GITHUB_WORKFLOW_REF:
            "everr-labs/everr/.github/workflows/build.yml@refs/heads/main",
          GITHUB_WORKFLOW: "Build & Test Collector",
          GITHUB_JOB: "lint",
          GITHUB_REPOSITORY: "everr-labs/everr",
          GITHUB_RUN_ID: "123",
          GITHUB_RUN_ATTEMPT: "1",
          RUNNER_NAME: "GitHub Actions 1",
        },
        getInput: (name: string) => (name === "github-token" ? "token" : "5"),
        info: (message: string) => infoMessages.push(message),
        warning: () => {},
        readFile: (filePath: string, encoding: "utf8") =>
          fsp.readFile(filePath, encoding),
        readdir: (directoryPath: string, options: { withFileTypes: true }) =>
          fsp.readdir(directoryPath, options),
        fetchImpl: async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              total_count: 1,
              jobs: [
                {
                  name: "Lint",
                  status: "in_progress",
                  runner_name: "GitHub Actions 1",
                  started_at: "2026-03-10T10:00:01.000Z",
                  check_run_url:
                    "https://api.github.com/repos/everr-labs/everr/check-runs/101",
                },
              ],
            }),
          }) as Response,
        now: () => new Date("2026-03-10T10:00:02.000Z"),
      });

      assert.equal(checkRunId, "101");
      assert.match(infoMessages[0], /resolved check run 101/);
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  },
);

test("startResourceUsage no-ops on non-linux runners", async () => {
  const savedState = new Map<string, string>();
  const infoMessages: string[] = [];

  const result = await startResourceUsage({
    env: {
      RUNNER_OS: "Windows",
      GITHUB_ACTION_PATH: "/action",
    },
    getInput: (name: string) => (name === "github-token" ? "token" : "5"),
    saveState: (key: string, value: string) => savedState.set(key, value),
    info: (message: string) => infoMessages.push(message),
    warning: () => {},
  });

  assert.equal(result.enabled, false);
  assert.equal(savedState.get("enabled"), "0");
  assert.match(infoMessages[0], /supported only on Linux runners/);
});

test("startResourceUsage downgrades sampler startup failures to warnings", async () => {
  const savedState = new Map<string, string>();
  const warnings: string[] = [];
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "everr-ru-start-"));

  try {
    const result = await startResourceUsage({
      env: {
        RUNNER_OS: "Linux",
        GITHUB_ACTION_PATH: "/action",
        RUNNER_TEMP: tempDir,
        GITHUB_API_URL: "https://api.github.com",
        GITHUB_RUN_ID: "12",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_JOB: "lint",
        GITHUB_REPOSITORY: "everr-labs/everr",
        GITHUB_WORKSPACE: tempDir,
        GITHUB_WORKFLOW: "Build & Test Collector",
        GITHUB_WORKFLOW_REF:
          "everr-labs/everr/.github/workflows/build.yml@refs/heads/main",
      },
      getInput: (name: string) => (name === "github-token" ? "token" : "5"),
      saveState: (key: string, value: string) => savedState.set(key, value),
      warning: (message: string) => warnings.push(message),
      fetchImpl: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            total_count: 1,
            jobs: [
              {
                name: "lint",
                status: "in_progress",
                runner_name: "",
                started_at: "2026-03-10T10:00:01.000Z",
                check_run_url:
                  "https://api.github.com/repos/everr-labs/everr/check-runs/111",
              },
            ],
          }),
        }) as Response,
      spawnImpl: () => {
        throw new Error("spawn failed");
      },
    });

    assert.equal(result.enabled, false);
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
    const workflowDir = path.join(tempDir, ".github", "workflows");
    await fsp.mkdir(workflowDir, { recursive: true });
    await fsp.writeFile(
      path.join(workflowDir, "build.yml"),
      [
        "name: Build & Test Collector",
        "jobs:",
        "  lint:",
        "    name: Lint",
        "    runs-on: ubuntu-latest",
        "    steps: []",
      ].join("\n"),
      "utf8",
    );

    const result = await startResourceUsage({
      env: {
        RUNNER_OS: "Linux",
        RUNNER_TEMP: tempDir,
        GITHUB_API_URL: "https://api.github.com",
        GITHUB_RUN_ID: "12",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_JOB: "lint",
        GITHUB_REPOSITORY: "everr-labs/everr",
        GITHUB_WORKSPACE: tempDir,
        GITHUB_WORKFLOW: "Build & Test Collector",
        GITHUB_WORKFLOW_REF:
          "everr-labs/everr/.github/workflows/build.yml@refs/heads/main",
      },
      getInput: (name: string) => (name === "github-token" ? "token" : "5"),
      saveState: (key: string, value: string) => savedState.set(key, value),
      info: () => {},
      warning: () => {},
      fetchImpl: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({
            total_count: 1,
            jobs: [
              {
                name: "Lint",
                status: "in_progress",
                runner_name: "",
                started_at: "2026-03-10T10:00:01.000Z",
                check_run_url:
                  "https://api.github.com/repos/everr-labs/everr/check-runs/222",
              },
            ],
          }),
        }) as Response,
      spawnImpl: ((file: string, args: readonly string[]) => {
        spawnInvocation = { file, args };
        return {
          pid: 321,
          unref() {},
        } as any;
      }) as typeof import("node:child_process").spawn,
    });

    assert.equal(result.enabled, true);
    assert.equal(spawnInvocation?.file, "bash");
    assert.equal(
      spawnInvocation?.args[0],
      path.join(resolveActionRoot(fileURLToPath(import.meta.url)), "scripts", "sampler.sh"),
    );
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
      path.join(resolveActionRoot(fileURLToPath(import.meta.url)), "dist", "finalize.mjs"),
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
