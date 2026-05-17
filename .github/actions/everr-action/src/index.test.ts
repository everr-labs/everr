import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  artifactNameForCheckRun,
  buildRuntimePaths,
  checkRunIdFromUrl,
  discoverCurrentCheckRunId,
  finalizeAndUploadResourceUsage,
  isResourceUsageEnabled,
  normalizeCheckRunId,
  resolveActionRoot,
  startResourceUsage,
} from "./index.ts";

function inputResolver(values: Record<string, string>): (name: string) => string {
  return (name: string) => values[name] ?? "";
}

function jsonResponse(status: number, body: unknown) {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
}

function mockFetch(
  responses: Array<{ body: unknown; status: number }>,
): {
  calls: Array<{ headers: Record<string, string>; url: string }>;
  fetch: (
    input: string,
    init: { headers: Record<string, string> },
  ) => Promise<ReturnType<typeof jsonResponse>>;
} {
  const calls: Array<{ headers: Record<string, string>; url: string }> = [];
  let i = 0;
  return {
    calls,
    fetch: async (
      input: string,
      init: { headers: Record<string, string> },
    ) => {
      calls.push({ headers: init.headers, url: input });
      const next = responses[i++];
      if (!next) {
        throw new Error("no more mocked responses");
      }
      return jsonResponse(next.status, next.body);
    },
  };
}

const defaultEnvForDiscovery = {
  GITHUB_REPOSITORY: "everr-labs/everr",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_RUN_ID: "12",
  RUNNER_NAME: "runner-7",
};

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

test("checkRunIdFromUrl extracts the trailing id and rejects malformed values", () => {
  assert.equal(
    checkRunIdFromUrl("https://api.github.com/repos/o/r/check-runs/12345"),
    "12345",
  );
  assert.equal(checkRunIdFromUrl("https://api.github.com/repos/o/r/check-runs/"), null);
  assert.equal(checkRunIdFromUrl(""), null);
});

test("discoverCurrentCheckRunId returns the in_progress job on this runner", async () => {
  const { calls, fetch } = mockFetch([
    {
      status: 200,
      body: {
        total_count: 2,
        jobs: [
          {
            name: "Build",
            runner_name: "runner-9",
            status: "in_progress",
            check_run_url: "https://api.github.com/repos/everr-labs/everr/check-runs/9999",
          },
          {
            name: "Lint",
            runner_name: "runner-7",
            status: "in_progress",
            check_run_url: "https://api.github.com/repos/everr-labs/everr/check-runs/4242",
          },
        ],
      },
    },
  ]);

  const result = await discoverCurrentCheckRunId({
    env: defaultEnvForDiscovery,
    fetchImpl: fetch,
    token: "ghs_xyz",
    warning: () => {},
  });

  assert.equal(result, "4242");
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].url,
    /\/repos\/everr-labs\/everr\/actions\/runs\/12\/attempts\/1\/jobs/,
  );
  assert.equal(calls[0].headers.Authorization, "Bearer ghs_xyz");
});

test("discoverCurrentCheckRunId warns and returns null when the API rejects the request", async () => {
  const warnings: string[] = [];
  const { fetch } = mockFetch([{ status: 403, body: { message: "no" } }]);

  const result = await discoverCurrentCheckRunId({
    env: defaultEnvForDiscovery,
    fetchImpl: fetch,
    token: "ghs_xyz",
    warning: (message: string) => warnings.push(message),
  });

  assert.equal(result, null);
  assert.match(warnings[0], /jobs API returned 403/);
});

test("discoverCurrentCheckRunId warns when no in_progress job matches the runner", async () => {
  const warnings: string[] = [];
  const { fetch } = mockFetch([
    {
      status: 200,
      body: {
        total_count: 1,
        jobs: [
          {
            name: "Build",
            runner_name: "runner-9",
            status: "in_progress",
            check_run_url: "https://api.github.com/repos/o/r/check-runs/9999",
          },
        ],
      },
    },
  ]);

  const result = await discoverCurrentCheckRunId({
    env: defaultEnvForDiscovery,
    fetchImpl: fetch,
    token: "ghs_xyz",
    warning: (message: string) => warnings.push(message),
  });

  assert.equal(result, null);
  assert.match(warnings[0], /no in_progress job on runner 'runner-7'/);
});

test("discoverCurrentCheckRunId warns when required env vars are missing", async () => {
  const warnings: string[] = [];
  const { fetch, calls } = mockFetch([]);

  const result = await discoverCurrentCheckRunId({
    env: { GITHUB_RUN_ID: "12" },
    fetchImpl: fetch,
    token: "ghs_xyz",
    warning: (message: string) => warnings.push(message),
  });

  assert.equal(result, null);
  assert.equal(calls.length, 0);
  assert.match(warnings[0], /GITHUB_REPOSITORY, GITHUB_RUN_ID, or RUNNER_NAME is missing/);
});

test("isResourceUsageEnabled accepts only the literal string 'true'", () => {
  assert.equal(isResourceUsageEnabled(inputResolver({ "resource-usage": "true" })), true);
  assert.equal(isResourceUsageEnabled(inputResolver({ "resource-usage": "TRUE" })), true);
  assert.equal(isResourceUsageEnabled(inputResolver({ "resource-usage": " true " })), true);
  assert.equal(isResourceUsageEnabled(inputResolver({ "resource-usage": "false" })), false);
  assert.equal(isResourceUsageEnabled(inputResolver({ "resource-usage": "1" })), false);
  assert.equal(isResourceUsageEnabled(inputResolver({})), false);
});

test("startResourceUsage no-ops when resource-usage input is not enabled", async () => {
  const savedState = new Map<string, string>();
  const infoMessages: string[] = [];

  const result = await startResourceUsage({
    env: {
      RUNNER_OS: "Linux",
    },
    getInput: inputResolver({ "resource-usage": "false", "github-token": "ghs_xyz" }),
    saveState: (key: string, value: string) => savedState.set(key, value),
    info: (message: string) => infoMessages.push(message),
    warning: () => {},
  });

  assert.equal(result.enabled, false);
  assert.equal(savedState.get("enabled"), "0");
  assert.equal(infoMessages.length, 0);
});

test("startResourceUsage no-ops on non-linux runners", async () => {
  const savedState = new Map<string, string>();
  const infoMessages: string[] = [];

  const result = await startResourceUsage({
    env: {
      RUNNER_OS: "Windows",
    },
    getInput: inputResolver({ "resource-usage": "true", "github-token": "ghs_xyz" }),
    saveState: (key: string, value: string) => savedState.set(key, value),
    info: (message: string) => infoMessages.push(message),
    warning: () => {},
  });

  assert.equal(result.enabled, false);
  assert.equal(savedState.get("enabled"), "0");
  assert.match(infoMessages[0], /supported only on Linux runners/);
});

test("startResourceUsage skips sampling when github-token is missing", async () => {
  const savedState = new Map<string, string>();
  const warnings: string[] = [];

  const result = await startResourceUsage({
    env: {
      RUNNER_OS: "Linux",
    },
    getInput: inputResolver({ "resource-usage": "true", "github-token": "" }),
    saveState: (key: string, value: string) => savedState.set(key, value),
    info: () => {},
    warning: (message: string) => warnings.push(message),
  });

  assert.equal(result.enabled, false);
  assert.equal(savedState.get("enabled"), "0");
  assert.match(warnings[0], /no github-token/);
});

function jobsApiResponseFor(checkRunId: string, runnerName: string) {
  return {
    status: 200,
    body: {
      total_count: 1,
      jobs: [
        {
          name: "lint",
          runner_name: runnerName,
          status: "in_progress",
          check_run_url: `https://api.github.com/repos/everr-labs/everr/check-runs/${checkRunId}`,
        },
      ],
    },
  };
}

test("startResourceUsage downgrades sampler startup failures to warnings", async () => {
  const savedState = new Map<string, string>();
  const warnings: string[] = [];
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "everr-ru-start-"));
  const { fetch } = mockFetch([jobsApiResponseFor("111", "runner-7")]);

  try {
    const result = await startResourceUsage({
      env: {
        RUNNER_OS: "Linux",
        RUNNER_TEMP: tempDir,
        RUNNER_NAME: "runner-7",
        GITHUB_RUN_ID: "12",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_JOB: "lint",
        GITHUB_REPOSITORY: "everr-labs/everr",
        GITHUB_WORKSPACE: tempDir,
      },
      getInput: inputResolver({ "resource-usage": "true", "github-token": "ghs_xyz" }),
      fetchImpl: fetch,
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
  const { fetch } = mockFetch([jobsApiResponseFor("222", "runner-7")]);
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
        RUNNER_NAME: "runner-7",
        GITHUB_RUN_ID: "12",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_JOB: "lint",
        GITHUB_REPOSITORY: "everr-labs/everr",
        GITHUB_WORKSPACE: tempDir,
      },
      getInput: inputResolver({ "resource-usage": "true", "github-token": "ghs_xyz" }),
      fetchImpl: fetch,
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
