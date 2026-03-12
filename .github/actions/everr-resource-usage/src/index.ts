import type { Dirent } from "node:fs";
import { execFile, spawn } from "node:child_process";
import * as artifact from "@actions/artifact";
import * as core from "@actions/core";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

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

interface WorkflowJob {
  check_run_url?: string;
  name?: string;
  runner_name?: string;
  started_at?: string;
  status?: string;
}

interface WorkflowDocument {
  jobs?: Record<string, WorkflowJobDefinition>;
  name?: string;
}

type WorkflowJobDefinition = Record<string, unknown> & {
  name?: string;
};

type Env = NodeJS.ProcessEnv;
type GetInput = (name: string) => string;
type SaveState = (key: string, value: string) => void;
type ReadState = (key: string) => string;
type Log = (message: string) => void;
type Now = () => Date;
type ReadFile = (filePath: string, encoding: "utf8") => Promise<string>;
type Readdir = (
  directoryPath: string,
  options: { withFileTypes: true },
) => Promise<Dirent[]>;
type FetchImpl = typeof fetch;
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
  fetchImpl?: FetchImpl;
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

interface DiscoverCheckRunIdOptions {
  env?: Env;
  fetchImpl?: FetchImpl;
  getInput?: GetInput;
  info?: Log;
  now?: Now;
  readFile?: ReadFile;
  readdir?: Readdir;
  warning?: Log;
}

interface ResolveWorkflowJobNameOptions {
  env?: Env;
  readFile?: ReadFile;
  readdir?: Readdir;
}

interface SelectCheckRunIdOptions {
  hints?: string[];
  jobs: WorkflowJob[];
  now?: Now;
  runnerName?: string;
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
  fetchImpl = fetch,
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

  const checkRunId = await discoverCheckRunId({
    env,
    getInput,
    info,
    warning,
    readFile: fspModule.readFile.bind(fspModule),
    readdir: fspModule.readdir.bind(fspModule) as Readdir,
    fetchImpl,
    now,
  });
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

async function discoverCheckRunId({
  env = process.env,
  getInput = core.getInput,
  info = core.info,
  warning = core.warning,
  readFile = (filePath) => fsp.readFile(filePath, "utf8"),
  readdir = (directoryPath, options) => fsp.readdir(directoryPath, options),
  fetchImpl = fetch,
  now = () => new Date(),
}: DiscoverCheckRunIdOptions = {}): Promise<string | null> {
  const token = getInput("github-token");
  if (!token) {
    warning("resource-usage discovery skipped: missing github token");
    return null;
  }

  try {
    const hints = await resolveJobNameHints({ env, readFile, readdir });
    const jobs = await listWorkflowRunJobs({ env, token, fetchImpl });
    const checkRunId = selectCheckRunId({
      jobs,
      hints,
      runnerName: env.RUNNER_NAME || "",
      now,
    });

    if (!checkRunId) {
      warning(
        "resource-usage discovery skipped: could not match the current workflow job to a check run",
      );
      return null;
    }

    info(`resolved check run ${checkRunId}`);
    return String(checkRunId);
  } catch (error) {
    warning(`resource-usage discovery failed: ${formatError(error)}`);
    return null;
  }
}

async function resolveJobNameHints({
  env = process.env,
  readFile = (filePath) => fsp.readFile(filePath, "utf8"),
  readdir = (directoryPath, options) => fsp.readdir(directoryPath, options),
}: ResolveWorkflowJobNameOptions = {}): Promise<string[]> {
  const hints = new Set<string>();
  if (env.GITHUB_JOB) {
    hints.add(env.GITHUB_JOB);
  }

  const workflowJobName = await resolveWorkflowJobName({ env, readFile, readdir });
  if (workflowJobName) {
    hints.add(workflowJobName);
  }

  return [...hints].filter(Boolean);
}

async function resolveWorkflowJobName({
  env = process.env,
  readFile = (filePath) => fsp.readFile(filePath, "utf8"),
  readdir = (directoryPath, options) => fsp.readdir(directoryPath, options),
}: ResolveWorkflowJobNameOptions = {}): Promise<string> {
  const workflowPath = await resolveWorkflowPath({ env, readFile, readdir });
  if (!workflowPath) {
    return "";
  }

  const raw = await readFile(workflowPath, "utf8");
  const document = yaml.load(raw) as WorkflowDocument | undefined;
  const jobs = document?.jobs;
  const jobKey = env.GITHUB_JOB || "";
  const jobDefinition = jobKey ? jobs?.[jobKey] : undefined;
  if (!jobDefinition || typeof jobDefinition !== "object" || Array.isArray(jobDefinition)) {
    return env.GITHUB_JOB || "";
  }

  if (typeof jobDefinition.name === "string" && jobDefinition.name.trim() !== "") {
    return jobDefinition.name.trim();
  }

  return env.GITHUB_JOB || "";
}

async function resolveWorkflowPath({
  env = process.env,
  readFile = (filePath) => fsp.readFile(filePath, "utf8"),
  readdir = (directoryPath, options) => fsp.readdir(directoryPath, options),
}: ResolveWorkflowJobNameOptions = {}): Promise<string | null> {
  const workspacePath = env.GITHUB_WORKSPACE || process.cwd();
  const relativeFromRef = workflowPathFromRef(env.GITHUB_WORKFLOW_REF || "");
  if (relativeFromRef) {
    const absolutePath = path.join(workspacePath, relativeFromRef);
    try {
      await readFile(absolutePath, "utf8");
      return absolutePath;
    } catch {
      // Fall back to a workflow name scan below.
    }
  }

  if (!env.GITHUB_WORKFLOW) {
    return null;
  }

  const workflowDirectory = path.join(workspacePath, ".github", "workflows");
  let entries: Dirent[];
  try {
    entries = await readdir(workflowDirectory, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".yml") && !entry.name.endsWith(".yaml")) {
      continue;
    }

    const candidatePath = path.join(workflowDirectory, entry.name);
    try {
      const raw = await readFile(candidatePath, "utf8");
      const document = yaml.load(raw) as WorkflowDocument | undefined;
      if (document?.name === env.GITHUB_WORKFLOW) {
        return candidatePath;
      }
    } catch {
      // Ignore unrelated or malformed workflow files when probing.
    }
  }

  return null;
}

function workflowPathFromRef(workflowRef: string): string {
  if (!workflowRef || !workflowRef.includes("@")) {
    return "";
  }

  const beforeRef = workflowRef.slice(0, workflowRef.lastIndexOf("@"));
  const parts = beforeRef.split("/");
  if (parts.length < 3) {
    return "";
  }

  return parts.slice(2).join("/");
}

async function listWorkflowRunJobs({
  env = process.env,
  token,
  fetchImpl = fetch,
}: {
  env?: Env;
  fetchImpl?: FetchImpl;
  token: string;
}): Promise<WorkflowJob[]> {
  const repository = env.GITHUB_REPOSITORY || "";
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error("missing GITHUB_REPOSITORY");
  }

  const runID = env.GITHUB_RUN_ID;
  if (!runID) {
    throw new Error("missing GITHUB_RUN_ID");
  }

  const apiBase = env.GITHUB_API_URL || "https://api.github.com";
  const runAttempt = env.GITHUB_RUN_ATTEMPT;
  const baseURL = runAttempt
    ? `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runID)}/attempts/${encodeURIComponent(runAttempt)}/jobs`
    : `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runID)}/jobs`;

  const jobs: WorkflowJob[] = [];
  for (let page = 1; page < 100; page += 1) {
    const response = await fetchImpl(`${baseURL}?per_page=100&page=${page}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "everr-resource-usage-action",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!response.ok) {
      throw new Error(`workflow jobs request failed with status ${response.status}`);
    }

    const payload = (await response.json()) as {
      jobs?: WorkflowJob[];
      total_count?: number;
    };
    const pageJobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    jobs.push(...pageJobs);

    if (pageJobs.length < 100 || jobs.length >= (payload.total_count || 0)) {
      break;
    }
  }

  return jobs;
}

function selectCheckRunId({
  jobs,
  hints = [],
  runnerName = "",
  now = () => new Date(),
}: SelectCheckRunIdOptions): number | null {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return null;
  }

  const activeJobs = jobs.filter((job) => isActiveJob(job.status || ""));
  let candidates = activeJobs.length > 0 ? activeJobs : jobs;

  if (runnerName) {
    const runnerMatches = candidates.filter((job) => job.runner_name === runnerName);
    if (runnerMatches.length > 0) {
      candidates = runnerMatches;
    }
  }

  const normalizedHints = hints
    .map((hint) => hint.trim())
    .filter(Boolean);
  if (normalizedHints.length > 0) {
    const hintMatches = candidates.filter(
      (job) => typeof job.name === "string" && normalizedHints.includes(job.name),
    );
    if (hintMatches.length === 1) {
      return parseCheckRunId(jobCheckRunURL(hintMatches[0]));
    }
    if (hintMatches.length > 1) {
      candidates = hintMatches;
    }
  }

  if (candidates.length === 1) {
    return parseCheckRunId(jobCheckRunURL(candidates[0]));
  }

  const inProgress = candidates.filter((job) => job.status === "in_progress");
  if (inProgress.length === 1) {
    return parseCheckRunId(jobCheckRunURL(inProgress[0]));
  }
  if (inProgress.length > 1) {
    candidates = inProgress;
  }

  const referenceTime = now().valueOf();
  const startedCandidates = candidates
    .map((job) => ({
      job,
      startedAt: Number.isNaN(Date.parse(job.started_at || ""))
        ? null
        : Date.parse(job.started_at || ""),
    }))
    .filter(
      (entry): entry is { job: WorkflowJob; startedAt: number } =>
        entry.startedAt !== null,
    )
    .sort(
      (left, right) =>
        Math.abs(left.startedAt - referenceTime) -
        Math.abs(right.startedAt - referenceTime),
    );

  if (startedCandidates.length > 0) {
    return parseCheckRunId(jobCheckRunURL(startedCandidates[0].job));
  }

  return null;
}

function isActiveJob(status: string): boolean {
  return (
    status === "in_progress" ||
    status === "queued" ||
    status === "waiting" ||
    status === "pending" ||
    status === "requested"
  );
}

function jobCheckRunURL(job: WorkflowJob | undefined): string {
  if (!job || typeof job.check_run_url !== "string") {
    return "";
  }
  return job.check_run_url;
}

function parseCheckRunId(checkRunURL: string): number | null {
  if (!checkRunURL) {
    return null;
  }

  const segments = checkRunURL.split("/");
  const raw = segments[segments.length - 1];
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
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
  discoverCheckRunId,
  ensureSamplesFile,
  finalizeAndUploadResourceUsage,
  formatError,
  isActiveJob,
  listWorkflowRunJobs,
  parseCheckRunId,
  resolveActionRoot,
  resolveJobNameHints,
  resolveWorkspaceFilesystemInfo,
  resolveWorkflowJobName,
  resolveWorkflowPath,
  selectCheckRunId,
  startResourceUsage,
  stopSampler,
  workflowPathFromRef,
};
