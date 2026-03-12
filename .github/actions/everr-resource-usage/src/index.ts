import { execFile, spawn } from "node:child_process";
import * as artifact from "@actions/artifact";
import * as core from "@actions/core";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const artifactClient = new artifact.DefaultArtifactClient();

interface RuntimePaths {
  baseDir: string;
  samplesPath: string;
  pidPath: string;
  logPath: string;
  outputDir: string;
}

interface FilesystemInfo {
  device: string;
  mountpoint: string;
  type: string;
}

type Env = NodeJS.ProcessEnv;
type GetInput = (name: string) => string;
type SaveState = (key: string, value: string) => void;
type ReadState = (key: string) => string;
type Log = (message: string) => void;
type Now = () => Date;
type ExecFileImpl = (
  file: string,
  args: readonly string[],
) => Promise<unknown>;
type ResolveFilesystemInfo = (workspacePath: string) => Promise<FilesystemInfo>;
type UploadArtifactImpl = (
  name: string,
  files: string[],
  rootDirectory: string,
  options: { retentionDays: number },
) => Promise<unknown>;

const defaultSampleIntervalSeconds = "5";

interface StartResourceUsageOptions {
  env?: Env;
  fsModule?: typeof fs;
  fspModule?: typeof fsp;
  getInput?: GetInput;
  info?: Log;
  now?: Now;
  saveState?: SaveState;
  spawnImpl?: typeof spawn;
  warning?: Log;
}

interface FinalizeAndUploadResourceUsageOptions {
  env?: Env;
  execFileImpl?: ExecFileImpl;
  fspModule?: typeof fsp;
  info?: Log;
  now?: Now;
  readState?: ReadState;
  resolveFilesystemInfo?: ResolveFilesystemInfo;
  uploadArtifactImpl?: UploadArtifactImpl;
  warning?: Log;
}

function artifactNameForCheckRun(checkRunId: string): string {
  return `everr-resource-usage-v2-${checkRunId}`;
}

function resolveActionRoot(entrypointPath = fileURLToPath(import.meta.url)): string {
  return path.resolve(path.dirname(entrypointPath), "..");
}

function buildRuntimePaths(env: Env = process.env): RuntimePaths {
  const runnerTemp = env.RUNNER_TEMP || os.tmpdir();
  const baseDir = path.join(
    runnerTemp,
    "everr-resource-usage",
    `${env.GITHUB_RUN_ID || "0"}-${env.GITHUB_RUN_ATTEMPT || "0"}-${env.GITHUB_JOB || "job"}`,
  );

  return {
    baseDir,
    samplesPath: path.join(baseDir, "samples.ndjson"),
    pidPath: path.join(baseDir, "sampler.pid"),
    logPath: path.join(baseDir, "sampler.log"),
    outputDir: path.join(baseDir, "artifact"),
  };
}

function normalizeCheckRunId(rawCheckRunId: string): string | null {
  const checkRunId = rawCheckRunId.trim();
  if (!/^[1-9]\d*$/.test(checkRunId)) {
    return null;
  }

  return checkRunId;
}

function resolveCheckRunIdInput({
  getInput = core.getInput,
  warning = core.warning,
}: {
  getInput?: GetInput;
  warning?: Log;
} = {}): string | null {
  const checkRunId = normalizeCheckRunId(getInput("check-run-id"));
  if (!checkRunId) {
    warning("resource-usage skipped: missing or invalid check-run-id input");
    return null;
  }

  return checkRunId;
}

async function startResourceUsage({
  env = process.env,
  fsModule = fs,
  fspModule = fsp,
  saveState = core.saveState,
  getInput = core.getInput,
  info = core.info,
  warning = core.warning,
  now = () => new Date(),
  spawnImpl = spawn,
}: StartResourceUsageOptions = {}): Promise<{
  checkRunId?: string;
  enabled: boolean;
  pid?: number;
}> {
  const actionRoot = resolveActionRoot();

  if (env.RUNNER_OS !== "Linux") {
    info("resource-usage sampling is supported only on Linux runners");
    saveState("enabled", "0");
    return { enabled: false };
  }

  const checkRunId = resolveCheckRunIdInput({ getInput, warning });
  if (!checkRunId) {
    saveState("enabled", "0");
    return { enabled: false };
  }

  saveState("checkRunId", checkRunId);
  const { baseDir, samplesPath, pidPath, logPath } = buildRuntimePaths(env);
  const samplerPath = path.join(actionRoot, "scripts", "sampler.sh");
  const workspacePath = env.GITHUB_WORKSPACE || process.cwd();
  const startedAt = now().toISOString();

  try {
    await fspModule.mkdir(baseDir, { recursive: true });
    await fspModule.writeFile(samplesPath, "", "utf8");

    const logFd = fsModule.openSync(logPath, "a");
    const child = spawnImpl(
      "bash",
      [samplerPath, samplesPath, workspacePath, defaultSampleIntervalSeconds],
      {
        detached: true,
        stdio: ["ignore", logFd, logFd],
      },
    );
    child.unref();
    fsModule.closeSync(logFd);

    if (child.pid === undefined) {
      throw new Error("sampler did not provide a pid");
    }

    await fspModule.writeFile(pidPath, `${child.pid}\n`, "utf8");

    saveState("enabled", "1");
    saveState("baseDir", baseDir);
    saveState("samplesPath", samplesPath);
    saveState("pidPath", pidPath);
    saveState("logPath", logPath);
    saveState("startedAt", startedAt);
    saveState("workspacePath", workspacePath);

    info(`started resource-usage sampler for check run ${checkRunId}`);
    return {
      enabled: true,
      checkRunId,
      pid: child.pid,
    };
  } catch (error) {
    warning(`resource-usage sampler did not start: ${formatError(error)}`);
    saveState("enabled", "0");
    return { enabled: false, checkRunId };
  }
}

async function finalizeAndUploadResourceUsage({
  env = process.env,
  fspModule = fsp,
  readState = core.getState,
  info = core.info,
  warning = core.warning,
  now = () => new Date(),
  execFileImpl = execFileAsync,
  resolveFilesystemInfo = resolveWorkspaceFilesystemInfo,
  uploadArtifactImpl = (name, files, rootDirectory, options) =>
    artifactClient.uploadArtifact(name, files, rootDirectory, options),
}: FinalizeAndUploadResourceUsageOptions = {}): Promise<{
  artifactName?: string;
  enabled: boolean;
  failed?: boolean;
}> {
  if (readState("enabled") !== "1") {
    return { enabled: false };
  }

  const checkRunId = readState("checkRunId");
  const samplesPath = readState("samplesPath");
  const pidPath = readState("pidPath");
  const startedAt = readState("startedAt") || now().toISOString();
  const workspacePath =
    readState("workspacePath") || env.GITHUB_WORKSPACE || process.cwd();
  const { outputDir } = buildRuntimePaths(env);
  const completedAt = now().toISOString();
  const actionRoot = resolveActionRoot();

  try {
    await ensureSamplesFile(samplesPath, fspModule);
    await stopSampler(pidPath, warning, fspModule);
    const filesystem = await resolveFilesystemInfo(workspacePath);

    const finalizeScript = path.join(actionRoot, "dist", "finalize", "index.js");
    await execFileImpl(process.execPath, [
      finalizeScript,
      "--samples-path",
      samplesPath,
      "--output-dir",
      outputDir,
      "--check-run-id",
      checkRunId,
      "--repo",
      env.GITHUB_REPOSITORY || "",
      "--run-id",
      env.GITHUB_RUN_ID || "0",
      "--run-attempt",
      env.GITHUB_RUN_ATTEMPT || "0",
      "--github-job",
      env.GITHUB_JOB || "",
      "--runner-name",
      env.RUNNER_NAME || "",
      "--runner-os",
      env.RUNNER_OS || "",
      "--runner-arch",
      env.RUNNER_ARCH || "",
      "--filesystem-device",
      filesystem.device,
      "--filesystem-mountpoint",
      filesystem.mountpoint,
      "--filesystem-type",
      filesystem.type,
      "--started-at",
      startedAt,
      "--completed-at",
      completedAt,
    ]);

    const files = [
      path.join(outputDir, "metadata.json"),
      path.join(outputDir, "samples.ndjson"),
    ];
    const artifactName = artifactNameForCheckRun(checkRunId);

    await uploadArtifactImpl(artifactName, files, outputDir, {
      retentionDays: 7,
    });
    info(`uploaded resource-usage artifact ${artifactName}`);
    return { enabled: true, artifactName };
  } catch (error) {
    warning(`resource-usage finalization failed: ${formatError(error)}`);
    return { enabled: true, failed: true };
  }
}

async function ensureSamplesFile(
  samplesPath: string,
  fspModule: typeof fsp = fsp,
): Promise<void> {
  if (!samplesPath) {
    return;
  }

  await fspModule.mkdir(path.dirname(samplesPath), { recursive: true });
  try {
    await fspModule.access(samplesPath, fs.constants.F_OK);
  } catch {
    await fspModule.writeFile(samplesPath, "", "utf8");
  }
}

async function stopSampler(
  pidPath: string,
  warning: Log = core.warning,
  fspModule: typeof fsp = fsp,
): Promise<void> {
  if (!pidPath) {
    return;
  }

  let rawPid: string;
  try {
    rawPid = await fspModule.readFile(pidPath, "utf8");
  } catch {
    return;
  }

  const pid = Number.parseInt(rawPid.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (isNodeError(error) && error.code !== "ESRCH") {
      warning(`failed to stop sampler ${pid}: ${formatError(error)}`);
    }
    return;
  }

  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    await sleep(100);
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (isNodeError(error) && error.code === "ESRCH") {
        return;
      }
      break;
    }
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function resolveWorkspaceFilesystemInfo(
  workspacePath: string,
): Promise<FilesystemInfo> {
  const { stdout } = await execFileWithOutput("df", ["-PkT", "--", workspacePath]);
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("df output did not include a filesystem row");
  }

  const fields = lines[1].split(/\s+/);
  if (fields.length < 7) {
    throw new Error("df output did not include device, type, and mountpoint");
  }

  return {
    device: fields[0] || "",
    type: fields[1] || "",
    mountpoint: fields[6] || "",
  };
}

async function execFileAsync(
  file: string,
  args: readonly string[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(file, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function execFileWithOutput(
  file: string,
  args: readonly string[],
): Promise<{ stderr: string; stdout: string }> {
  return await new Promise<{ stderr: string; stdout: string }>(
    (resolve, reject) => {
      execFile(file, args, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      });
    },
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

async function run(): Promise<void> {
  const isPost = core.getState("isPost") === "true";
  if (!isPost) {
    core.saveState("isPost", "true");
    await startResourceUsage();
    return;
  }

  await finalizeAndUploadResourceUsage();
}

const entrypointPath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (entrypointPath === fileURLToPath(import.meta.url)) {
  run().catch((error: unknown) => {
    core.warning(`resource-usage action failed: ${formatError(error)}`);
  });
}

export {
  artifactNameForCheckRun,
  buildRuntimePaths,
  ensureSamplesFile,
  finalizeAndUploadResourceUsage,
  formatError,
  normalizeCheckRunId,
  resolveActionRoot,
  resolveCheckRunIdInput,
  resolveWorkspaceFilesystemInfo,
  startResourceUsage,
  stopSampler,
};
