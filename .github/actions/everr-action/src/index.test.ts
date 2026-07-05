import assert from "node:assert/strict";
import type { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { finalizePartialArtifact } from "../scripts/finalize.ts";

import {
  artifactNameForCheckRun,
  buildRuntimePaths,
  bundledCliTargetForRuntime,
  cliDownloadBinaryName,
  finalizeAndUploadResourceUsage,
  installCli,
  isCliInstallEnabled,
  isResourceUsageEnabled,
  normalizeCheckRunId,
  resolveActionRoot,
  resolveCheckRunIdInput,
  startResourceUsage,
} from "./index.ts";

function inputResolver(values: Record<string, string>): (name: string) => string {
  return (name: string) => values[name] ?? "";
}

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
  assert.equal(paths.outputDir, "/tmp/runner/everr-resource-usage/12-3-lint/artifact");
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

test("isResourceUsageEnabled accepts only the literal string 'true'", () => {
  assert.equal(isResourceUsageEnabled(inputResolver({ "resource-usage": "true" })), true);
  assert.equal(isResourceUsageEnabled(inputResolver({ "resource-usage": "TRUE" })), true);
  assert.equal(isResourceUsageEnabled(inputResolver({ "resource-usage": " true " })), true);
  assert.equal(isResourceUsageEnabled(inputResolver({ "resource-usage": "false" })), false);
  assert.equal(isResourceUsageEnabled(inputResolver({ "resource-usage": "1" })), false);
  assert.equal(isResourceUsageEnabled(inputResolver({})), false);
});

test("isCliInstallEnabled accepts only the literal string 'true'", () => {
  assert.equal(isCliInstallEnabled(inputResolver({ "install-cli": "true" })), true);
  assert.equal(isCliInstallEnabled(inputResolver({ "install-cli": "TRUE" })), true);
  assert.equal(isCliInstallEnabled(inputResolver({ "install-cli": " true " })), true);
  assert.equal(isCliInstallEnabled(inputResolver({ "install-cli": "false" })), false);
  assert.equal(isCliInstallEnabled(inputResolver({ "install-cli": "1" })), false);
  assert.equal(isCliInstallEnabled(inputResolver({})), false);
});

test("bundledCliTargetForRuntime supports bundled release targets", () => {
  assert.equal(bundledCliTargetForRuntime("darwin", "arm64"), "darwin-arm64");
  assert.equal(bundledCliTargetForRuntime("linux", "arm64"), "linux-arm64");
  assert.equal(bundledCliTargetForRuntime("linux", "x64"), "linux-x64");
  assert.equal(bundledCliTargetForRuntime("darwin", "x64"), null);
  assert.equal(bundledCliTargetForRuntime("win32", "x64"), null);
});

test("cliDownloadBinaryName maps targets to everr.dev asset names", () => {
  assert.equal(cliDownloadBinaryName("darwin-arm64"), "everr");
  assert.equal(cliDownloadBinaryName("linux-arm64"), "everr-linux-arm64");
  assert.equal(cliDownloadBinaryName("linux-x64"), "everr-linux-x86_64");
  assert.equal(cliDownloadBinaryName("darwin-x64"), null);
});

test("installCli no-ops when install-cli input is disabled", async () => {
  let didAddPath = false;

  const result = await installCli({
    getInput: inputResolver({ "install-cli": "false" }),
    addPath: () => {
      didAddPath = true;
    },
  });

  assert.equal(result.enabled, false);
  assert.equal(didAddPath, false);
});

test("installCli warns on unsupported runners", async () => {
  const warnings: string[] = [];

  const result = await installCli({
    getInput: inputResolver({ "install-cli": "true" }),
    platform: "win32",
    arch: "x64",
    warning: (message: string) => warnings.push(message),
  });

  assert.deepEqual(result, { enabled: true, failed: true });
  assert.match(warnings[0], /unsupported runner win32-x64/);
});

test("installCli downloads from everr.dev and adds to PATH", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "everr-action-cli-"));
  const installDir = path.join(tempDir, "everr-cli");
  const cliPath = path.join(installDir, "everr");
  const paths: string[] = [];
  const infos: string[] = [];

  const binaryContent = Buffer.from("fake-everr-binary");
  const binaryHash = createHash("sha256").update(binaryContent).digest("hex");

  const fileStore = new Map<string, Buffer>();
  const fetchCalls: Array<{ url: string }> = [];

  const fetchImpl = async (url: string) => {
    fetchCalls.push({ url });
    const isChecksum = url.endsWith(".sha256");
    const content = isChecksum ? Buffer.from(`${binaryHash}  everr\n`) : binaryContent;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array(content).buffer as ArrayBuffer,
    };
  };

  const fspMock = {
    mkdir: async (_dir: string, _opts?: unknown) => {},
    writeFile: async (p: string, data: Buffer) => {
      fileStore.set(p, data);
    },
    readFile: async (p: string, _encoding?: BufferEncoding) => {
      if (p.endsWith("everr.sha256")) {
        const content = `${binaryHash}  everr\n`;
        return _encoding ? content : Buffer.from(content);
      }
      if (p === cliPath) {
        return _encoding ? binaryContent.toString(_encoding) : binaryContent;
      }
      throw new Error(`unexpected read: ${p}`);
    },
    chmod: async (_filePath: string, _mode: number) => {},
  };

  try {
    const result = await installCli({
      env: { RUNNER_TEMP: tempDir },
      fetchImpl,
      fspModule: fspMock as unknown as typeof fsp,
      getInput: inputResolver({ "install-cli": "true" }),
      platform: "darwin",
      arch: "arm64",
      addPath: (p: string) => paths.push(p),
      info: (m: string) => infos.push(m),
      warning: () => {},
    });

    assert.equal(result.enabled, true);
    assert.equal(result.path, cliPath);
    assert.equal(result.target, "darwin-arm64");
    assert.deepEqual(paths, [installDir]);
    assert.match(infos[0], /installed Everr CLI for darwin-arm64/);
    assert.equal(fetchCalls[0].url, "https://everr.dev/everr-app/everr");
    assert.equal(fetchCalls[1].url, "https://everr.dev/everr-app/everr.sha256");
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("installCli warns on download failure", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "everr-action-cli-"));
  const warnings: string[] = [];

  const fetchImpl = async (_url: string) => {
    throw new Error("network error");
  };
  const fspMock = {
    mkdir: async (_dir: string, _opts?: unknown) => {},
    writeFile: async () => {},
    readFile: async () => Buffer.alloc(0),
    chmod: async () => {},
  };

  try {
    const result = await installCli({
      env: { RUNNER_TEMP: tempDir },
      fetchImpl,
      fspModule: fspMock as unknown as typeof fsp,
      getInput: inputResolver({ "install-cli": "true" }),
      platform: "linux",
      arch: "x64",
      addPath: () => {},
      info: () => {},
      warning: (m: string) => warnings.push(m),
    });

    assert.equal(result.enabled, true);
    assert.equal(result.failed, true);
    assert.equal(result.target, "linux-x64");
    assert.match(warnings[0], /failed to install Everr CLI: network error/);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("startResourceUsage no-ops when resource-usage input is not enabled", async () => {
  const savedState = new Map<string, string>();
  const infoMessages: string[] = [];

  const result = await startResourceUsage({
    env: {
      RUNNER_OS: "Linux",
    },
    getInput: inputResolver({ "resource-usage": "false", "check-run-id": "123" }),
    saveState: (key: string, value: string) => savedState.set(key, value),
    info: (message: string) => infoMessages.push(message),
    warning: () => {},
  });

  assert.equal(result.enabled, false);
  assert.equal(savedState.get("enabled"), "0");
  assert.equal(infoMessages.length, 0);
});

test("startResourceUsage no-ops on unsupported runners", async () => {
  const savedState = new Map<string, string>();
  const infoMessages: string[] = [];

  const result = await startResourceUsage({
    env: {
      RUNNER_OS: "Windows",
    },
    getInput: inputResolver({ "resource-usage": "true", "check-run-id": "123" }),
    saveState: (key: string, value: string) => savedState.set(key, value),
    info: (message: string) => infoMessages.push(message),
    warning: () => {},
  });

  assert.equal(result.enabled, false);
  assert.equal(savedState.get("enabled"), "0");
  assert.match(infoMessages[0], /supported only on Linux and macOS runners/);
});

test("startResourceUsage skips sampling when check-run-id is missing", async () => {
  const savedState = new Map<string, string>();
  const warnings: string[] = [];

  const result = await startResourceUsage({
    env: {
      RUNNER_OS: "Linux",
    },
    getInput: inputResolver({ "resource-usage": "true", "check-run-id": "" }),
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
      getInput: inputResolver({ "resource-usage": "true", "check-run-id": "111" }),
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

test("startResourceUsage resolves sampler path without GITHUB_ACTION_PATH on Linux", async () => {
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
      getInput: inputResolver({ "resource-usage": "true", "check-run-id": "222" }),
      saveState: (key: string, value: string) => savedState.set(key, value),
      info: () => {},
      warning: () => {},
      spawnImpl: ((file: string, args: readonly string[]) => {
        spawnInvocation = { file, args };
        return {
          pid: 321,
          unref() {},
        } as unknown as ReturnType<typeof spawn>;
      }) as typeof spawn,
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

test("startResourceUsage spawns node with sampler-macos.mjs on macOS", async () => {
  const savedState = new Map<string, string>();
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "everr-ru-macos-"));
  let spawnInvocation:
    | {
        args: readonly string[];
        file: string;
      }
    | undefined;

  try {
    const result = await startResourceUsage({
      env: {
        RUNNER_OS: "macOS",
        RUNNER_TEMP: tempDir,
        GITHUB_RUN_ID: "12",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_JOB: "lint",
        GITHUB_REPOSITORY: "everr-labs/everr",
        GITHUB_WORKSPACE: tempDir,
      },
      getInput: inputResolver({ "resource-usage": "true", "check-run-id": "333" }),
      saveState: (key: string, value: string) => savedState.set(key, value),
      info: () => {},
      warning: () => {},
      spawnImpl: ((file: string, args: readonly string[]) => {
        spawnInvocation = { file, args };
        return {
          pid: 456,
          unref() {},
        } as unknown as ReturnType<typeof spawn>;
      }) as typeof spawn,
    });

    assert.equal(result.enabled, true);
    assert.equal(result.checkRunId, "333");
    assert.equal(spawnInvocation?.file, "node");
    assert.equal(
      spawnInvocation?.args[0],
      path.join(resolveActionRoot(fileURLToPath(import.meta.url)), "scripts", "sampler-macos.mjs"),
    );
    assert.equal(savedState.get("checkRunId"), "333");
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("finalizeAndUploadResourceUsage uploads the per-job artifact", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "everr-ru-finalize-"));
  const outputDir = path.join(tempDir, "everr-resource-usage", "123-1-lint", "artifact");
  const uploaded: Array<{
    files: string[];
    name: string;
    options: { retentionDays: number };
    rootDirectory: string;
  }> = [];
  const infos: string[] = [];
  let finalizeInvocation: Parameters<typeof finalizePartialArtifact>[0] | undefined;

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
          ({
            enabled: "1",
            checkRunId: "777",
            samplesPath: path.join(tempDir, "samples.ndjson"),
            pidPath: path.join(tempDir, "missing.pid"),
            startedAt: "2026-03-10T10:00:00.000Z",
          }) as Record<string, string>
        )[key] || "",
      finalizeImpl: (async (options) => {
        finalizeInvocation = options;
        await fsp.mkdir(outputDir, { recursive: true });
        await fsp.writeFile(path.join(outputDir, "metadata.json"), "{}\n", "utf8");
        await fsp.writeFile(path.join(outputDir, "samples.ndjson"), "", "utf8");
        return {} as unknown as Awaited<ReturnType<typeof finalizePartialArtifact>>;
      }) as typeof finalizePartialArtifact,
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
      files: [path.join(outputDir, "metadata.json"), path.join(outputDir, "samples.ndjson")],
      rootDirectory: outputDir,
      options: { retentionDays: 7 },
    });
    assert.equal(finalizeInvocation?.outputDir, outputDir);
    assert.equal(finalizeInvocation?.metadata.checkRunId, "777");
    assert.equal(finalizeInvocation?.metadata.repo, "everr-labs/everr");
    assert.equal(finalizeInvocation?.metadata.filesystemType, "ext4");
    assert.match(infos[0], /uploaded resource-usage artifact/);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});

test("finalizeAndUploadResourceUsage downgrades finalize failures to warnings", async () => {
  const warnings: string[] = [];

  const result = await finalizeAndUploadResourceUsage({
    env: {
      RUNNER_OS: "Linux",
      RUNNER_TEMP: os.tmpdir(),
      GITHUB_RUN_ID: "123",
      GITHUB_RUN_ATTEMPT: "1",
      GITHUB_JOB: "lint",
    },
    readState: (key: string) =>
      (
        ({
          enabled: "1",
          checkRunId: "777",
          samplesPath: path.join(os.tmpdir(), "missing.ndjson"),
          pidPath: path.join(os.tmpdir(), "missing.pid"),
          startedAt: "2026-03-10T10:00:00.000Z",
        }) as Record<string, string>
      )[key] || "",
    finalizeImpl: (async () => {
      throw new Error("finalize boom");
    }) as typeof finalizePartialArtifact,
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
});

test("finalizeAndUploadResourceUsage succeeds on macOS runners", async () => {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "everr-ru-finalize-macos-"));
  const outputDir = path.join(tempDir, "everr-resource-usage", "123-1-lint", "artifact");
  const uploaded: Array<{
    files: string[];
    name: string;
    options: { retentionDays: number };
    rootDirectory: string;
  }> = [];
  const infos: string[] = [];

  try {
    const result = await finalizeAndUploadResourceUsage({
      env: {
        RUNNER_TEMP: tempDir,
        GITHUB_RUN_ID: "123",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_JOB: "lint",
        GITHUB_REPOSITORY: "everr-labs/everr",
        RUNNER_OS: "macOS",
        RUNNER_ARCH: "ARM64",
        RUNNER_NAME: "GitHub Actions 1",
      },
      readState: (key: string) =>
        (
          ({
            enabled: "1",
            checkRunId: "888",
            samplesPath: path.join(tempDir, "samples.ndjson"),
            pidPath: path.join(tempDir, "missing.pid"),
            startedAt: "2026-03-10T10:00:00.000Z",
          }) as Record<string, string>
        )[key] || "",
      finalizeImpl: (async (_options) => {
        await fsp.mkdir(outputDir, { recursive: true });
        await fsp.writeFile(path.join(outputDir, "metadata.json"), "{}\n", "utf8");
        await fsp.writeFile(path.join(outputDir, "samples.ndjson"), "", "utf8");
        return {} as unknown as Awaited<ReturnType<typeof finalizePartialArtifact>>;
      }) as typeof finalizePartialArtifact,
      resolveFilesystemInfo: async () => ({
        device: "/dev/disk3s1",
        mountpoint: "/",
        type: "apfs",
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

    assert.equal(result.artifactName, "everr-resource-usage-v2-888");
    assert.deepEqual(uploaded[0], {
      name: "everr-resource-usage-v2-888",
      files: [path.join(outputDir, "metadata.json"), path.join(outputDir, "samples.ndjson")],
      rootDirectory: outputDir,
      options: { retentionDays: 7 },
    });
    assert.match(infos[0], /uploaded resource-usage artifact/);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
});
