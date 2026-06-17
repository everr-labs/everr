import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as artifact from "@actions/artifact";
import * as core from "@actions/core";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { finalizePartialArtifact } from "../scripts/finalize.ts";

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
type AddPath = (inputPath: string) => void;
type FinalizePartialArtifactImpl = typeof finalizePartialArtifact;
type FetchImpl = (
  url: string,
) => Promise<{ ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }>;
type ResolveFilesystemInfo = (workspacePath: string) => Promise<FilesystemInfo>;
type UploadArtifactImpl = (
  name: string,
  files: string[],
  rootDirectory: string,
  options: { retentionDays: number },
) => Promise<unknown>;

const CLI_DOWNLOAD_BASE_URL = "https://everr.dev/everr-app";

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

interface InstallCliOptions {
  addPath?: AddPath;
  arch?: string;
  env?: Env;
  fetchImpl?: FetchImpl;
  fspModule?: typeof fsp;
  getInput?: GetInput;
  info?: Log;
  platform?: string;
  warning?: Log;
}

interface FinalizeAndUploadResourceUsageOptions {
  env?: Env;
  finalizeImpl?: FinalizePartialArtifactImpl;
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

function isResourceUsageEnabled(getInput: GetInput): boolean {
  return getInput("resource-usage").trim().toLowerCase() === "true";
}

function isCliInstallEnabled(getInput: GetInput): boolean {
  return getInput("install-cli").trim().toLowerCase() === "true";
}

function bundledCliTargetForRuntime(
  platform: NodeJS.Platform | string = process.platform,
  arch: NodeJS.Architecture | string = process.arch,
): string | null {
  if (platform === "darwin" && arch === "arm64") {
    return "darwin-arm64";
  }

  if (platform === "linux" && arch === "arm64") {
    return "linux-arm64";
  }

  if (platform === "linux" && arch === "x64") {
    return "linux-x64";
  }

  return null;
}

function cliDownloadBinaryName(target: string): string | null {
  switch (target) {
    case "darwin-arm64":
      return "everr";
    case "linux-arm64":
      return "everr-linux-arm64";
    case "linux-x64":
      return "everr-linux-x86_64";
    default:
      return null;
  }
}

async function downloadFile(
  fetchImpl: FetchImpl,
  url: string,
  destPath: string,
  fspModule: typeof fsp,
): Promise<void> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fspModule.writeFile(destPath, buffer);
}

async function verifyChecksum(
  filePath: string,
  checksumPath: string,
  fspModule: typeof fsp,
): Promise<void> {
  const checksumContent = await fspModule.readFile(checksumPath, "utf8");
  const expectedHash = checksumContent.trim().split(/\s+/)[0];
  const fileBuffer = await fspModule.readFile(filePath);
  const actualHash = createHash("sha256").update(fileBuffer).digest("hex");
  if (expectedHash !== actualHash) {
    throw new Error(
      `SHA-256 mismatch: expected ${expectedHash}, got ${actualHash}`,
    );
  }
}

async function installCli({
  addPath = core.addPath,
  arch = process.arch,
  env = process.env,
  fetchImpl = fetch,
  fspModule = fsp,
  getInput = core.getInput,
  info = core.info,
  platform = process.platform,
  warning = core.warning,
}: InstallCliOptions = {}): Promise<{
  enabled: boolean;
  failed?: boolean;
  path?: string;
  target?: string;
}> {
  if (!isCliInstallEnabled(getInput)) {
    return { enabled: false };
  }

  const target = bundledCliTargetForRuntime(platform, arch);
  if (!target) {
    warning(`install-cli skipped: unsupported runner ${platform}-${arch}`);
    return { enabled: true, failed: true };
  }

  const binaryName = cliDownloadBinaryName(target);
  if (!binaryName) {
    warning(`install-cli skipped: no binary name for target ${target}`);
    return { enabled: true, failed: true, target };
  }

  const binaryUrl = `${CLI_DOWNLOAD_BASE_URL}/${binaryName}`;
  const checksumUrl = `${CLI_DOWNLOAD_BASE_URL}/${binaryName}.sha256`;
  const installDir = path.join(
    env.RUNNER_TEMP || os.tmpdir(),
    "everr-cli",
  );
  const cliPath = path.join(installDir, "everr");

  try {
    await fspModule.mkdir(installDir, { recursive: true });
    await downloadFile(fetchImpl, binaryUrl, cliPath, fspModule);
    await downloadFile(fetchImpl, checksumUrl, path.join(installDir, `${binaryName}.sha256`), fspModule);
    await verifyChecksum(cliPath, path.join(installDir, `${binaryName}.sha256`), fspModule);
    await fspModule.chmod(cliPath, 0o755);
    addPath(installDir);
    info(`installed Everr CLI for ${target} from ${binaryUrl}`);
    return { enabled: true, path: cliPath, target };
  } catch (error) {
    warning(
      `install-cli skipped: failed to install Everr CLI: ${formatError(error)}`,
    );
    return { enabled: true, failed: true, target };
  }
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
  if (!isResourceUsageEnabled(getInput)) {
    saveState("enabled", "0");
    return { enabled: false };
  }

  const actionRoot = resolveActionRoot();

  const runnerOs = env.RUNNER_OS || "";
  if (runnerOs !== "Linux" && runnerOs !== "macOS") {
    info(
      "resource-usage sampling is supported only on Linux and macOS runners",
    );
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
  const workspacePath = env.GITHUB_WORKSPACE || process.cwd();
  const startedAt = now().toISOString();

  const isMacOS = runnerOs === "macOS";
  const samplerPath = isMacOS
    ? path.join(actionRoot, "scripts", "sampler-macos.mjs")
    : path.join(actionRoot, "scripts", "sampler.sh");
  const spawnFile = isMacOS ? "node" : "bash";
  const spawnArgs = [samplerPath, samplesPath, workspacePath, defaultSampleIntervalSeconds];

  try {
    await fspModule.mkdir(baseDir, { recursive: true });
    await fspModule.writeFile(samplesPath, "", "utf8");

    const logFd = fsModule.openSync(logPath, "a");
    const child = spawnImpl(spawnFile, spawnArgs, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
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
  finalizeImpl = finalizePartialArtifact,
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

  try {
    await ensureSamplesFile(samplesPath, fspModule);
    await stopSampler(pidPath, warning, fspModule);
    const filesystem = await resolveFilesystemInfo(workspacePath);

    await finalizeImpl({
      samplesPath,
      outputDir,
      metadata: {
        checkRunId,
        repo: env.GITHUB_REPOSITORY || "",
        runId: env.GITHUB_RUN_ID || "0",
        runAttempt: env.GITHUB_RUN_ATTEMPT || "0",
        githubJob: env.GITHUB_JOB || "",
        runnerName: env.RUNNER_NAME || "",
        runnerOs: env.RUNNER_OS || "",
        runnerArch: env.RUNNER_ARCH || "",
        filesystemDevice: filesystem.device,
        filesystemMountpoint: filesystem.mountpoint,
        filesystemType: filesystem.type,
        startedAt,
        completedAt,
      },
    });

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
  runnerOs: string = process.env.RUNNER_OS || "",
): Promise<FilesystemInfo> {
  if (runnerOs === "macOS") {
    return resolveFilesystemInfoMacOS(workspacePath);
  }
  return resolveFilesystemInfoLinux(workspacePath);
}

async function resolveFilesystemInfoLinux(
  workspacePath: string,
): Promise<FilesystemInfo> {
  const { stdout } = await execFileWithOutput("df", [
    "-PkT",
    "--",
    workspacePath,
  ]);
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

async function resolveFilesystemInfoMacOS(
  workspacePath: string,
): Promise<FilesystemInfo> {
  const { stdout } = await execFileWithOutput("df", [
    "-Pk",
    "--",
    workspacePath,
  ]);
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("df output did not include a filesystem row");
  }

  const fields = lines[1].split(/\s+/);
  if (fields.length < 6) {
    throw new Error("df output did not include device and mountpoint");
  }

  const device = fields[0] || "";
  const mountpoint = fields[5] || "";

  let type = "";
  try {
    const { stdout: mountOutput } = await execFileWithOutput("mount", []);
    for (const line of mountOutput.split("\n")) {
      if (line.includes(` on ${mountpoint} `)) {
        const match = line.match(/\(([^,)]+)/);
        if (match) {
          type = match[1];
        }
        break;
      }
    }
  } catch {
    // filesystem type is best-effort on macOS
  }

  return { device, type, mountpoint };
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
    await installCli();
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
  bundledCliTargetForRuntime,
  cliDownloadBinaryName,
  ensureSamplesFile,
  finalizeAndUploadResourceUsage,
  formatError,
  installCli,
  isCliInstallEnabled,
  isResourceUsageEnabled,
  normalizeCheckRunId,
  resolveActionRoot,
  resolveCheckRunIdInput,
  resolveWorkspaceFilesystemInfo,
  startResourceUsage,
  stopSampler,
};
