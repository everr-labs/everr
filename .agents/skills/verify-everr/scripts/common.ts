// Shared paths and helpers for the verify-everr helper (verify-everr.ts, web.ts).
import { type StdioOptions, spawnSync } from "node:child_process";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import path from "node:path";
import { setTimeout as sleepMs } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(SCRIPT_DIR, "../../../..");
export const BIN = path.join(REPO, "target/debug/everr-dev");
export const STATE_DIR = path.join(REPO, ".verify-everr");
export const SCRATCH_ROOT = process.env.EVERR_VERIFY_SCRATCH || "/tmp/verify-everr";

export const sleep = (ms: number): Promise<void> => sleepMs(ms);

export function die(message: string): never {
  console.error(`verify-everr: ${message}`);
  process.exit(1);
}

export function required(value: string | undefined, what: string): string {
  if (value === undefined || value === "") die(`${what} required`);
  return value;
}

// Run ids name scratch dirs that cleanup deletes: allow only a safe charset, no "/" or "..".
export type RunId = string & { readonly __brand: "RunId" };

function isRunId(id: string): id is RunId {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes("..");
}

export function parseRunId(id: string): RunId {
  if (!isRunId(id)) die(`invalid run id '${id}' (use letters, digits, '.', '_', '-')`);
  return id;
}

/** `YYYYmmdd-HHMMSS-<pid>`, the default run id. */
export function defaultRunId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${process.pid}`;
}

export function hhmmss(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join("");
}

/** `date '+%F %T %Z'`, optionally of a file's mtime (`date -r`). */
export function stamp(file?: string): string {
  return run("date", [...(file ? ["-r", file] : []), "+%F %T %Z"]).stdout.trim();
}

export function readText(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

/** Contents of a one-line state file (`.verify-everr/current`), or "" if absent. */
export function readPointer(file: string): string {
  return (readText(file) ?? "").trim();
}

export type Proc = { status: number; stdout: string; stderr: string };

type RunOptions = { env?: NodeJS.ProcessEnv; cwd?: string };

/** Run a command to completion and capture its output. A missing binary is status 127. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Proc {
  const r = spawnSync(cmd, args, { encoding: "utf8", env: opts.env, cwd: opts.cwd, maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return { status: 127, stdout: "", stderr: `${cmd}: ${r.error.message}\n` };
  return { status: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
}

/** Run a command with the terminal attached (build output, pnpm install). Returns the exit status. */
export function runInherit(cmd: string, args: string[], opts: RunOptions = {}): number {
  const r = spawnSync(cmd, args, { stdio: "inherit", env: opts.env, cwd: opts.cwd });
  if (r.error) {
    console.error(`${cmd}: ${r.error.message}`);
    return 127;
  }
  return r.status ?? 1;
}

/**
 * Run a command with stdout/stderr written straight to files (`> out 2> err`; the same path for
 * both is `> out 2>&1`). `append` is `>>`. Returns the exit status.
 */
export function runToFiles(
  cmd: string,
  args: string[],
  files: { stdout: string; stderr?: string; append?: boolean },
  opts: RunOptions = {},
): number {
  const flags = files.append ? "a" : "w";
  const out = openSync(files.stdout, flags);
  const err = files.stderr && files.stderr !== files.stdout ? openSync(files.stderr, flags) : out;
  try {
    const stdio: StdioOptions = ["inherit", out, err];
    const r = spawnSync(cmd, args, { stdio, env: opts.env, cwd: opts.cwd });
    if (r.error) {
      writeFileSync(err, `${cmd}: ${r.error.message}\n`);
      return 127;
    }
    return r.status ?? 1;
  } finally {
    closeSync(out);
    if (err !== out) closeSync(err);
  }
}

/** Absolute path of an executable on PATH (`command -v`), or undefined. */
export function which(cmd: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, cmd);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}

export function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// The browser is driven with the agent-browser CLI, one session (one Chrome) per run.
export const AGENT_BROWSER_HINT = "install it: npm install -g agent-browser && agent-browser install";

export const browserSession = (id: string): string => `verify-everr-${id}`;

/** `agent-browser --version`, or undefined if it is not on PATH. */
export function agentBrowserVersion(): string | undefined {
  const r = run("agent-browser", ["--version"]);
  return r.status === 0 ? r.stdout.trim() : undefined;
}

/** Close a run's agent-browser session (its Chrome and daemon), appending the output to log. */
export async function closeBrowser(session: string, log: string): Promise<void> {
  if (!agentBrowserVersion()) return;
  runToFiles("agent-browser", ["--session", session, "close"], { stdout: log, append: true });
  const listed = () => run("agent-browser", ["session", "list"]).stdout.split("\n").some((l) => l.trim() === session);
  const deadline = Date.now() + 5000;
  while (listed() && Date.now() < deadline) await sleep(300);
  if (listed()) console.error(`warn: agent-browser session ${session} still open; run: agent-browser --session ${session} close`);
}

/** Shell lines for driving a run's browser: session, origin, evidence dir (created), and `ab_save <label>`. */
export function printBrowserEnv(vars: Record<string, string>, shots: string): number {
  mkdirSync(shots, { recursive: true });
  for (const [k, v] of Object.entries({ ...vars, SHOTS: shots })) console.log(`export ${k}='${v}'`);
  console.log(
    'ab_save() { agent-browser screenshot "$SHOTS/$1.png" >/dev/null && agent-browser get url >"$SHOTS/$1.url" && agent-browser get text body >"$SHOTS/$1.txt" && echo "saved $SHOTS/$1.{png,url,txt}"; }',
  );
  return 0;
}

/** A free loopback TCP port (bind to 0, read it back, close). */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("no port assigned"))));
    });
  });
}

export const portOf = (origin: string): string => origin.slice(origin.lastIndexOf(":") + 1);

/** PIDs listening on a TCP port, space-separated ("" if none). Needs ss from iproute2 (Linux). */
export function portPids(port: string | number): string {
  const out = run("ss", ["-Hltnp", `sport = :${port}`]).stdout;
  const pids = new Set([...out.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1])));
  return [...pids].sort((a, b) => a - b).join(" ");
}

/** True if the process exists (`kill -0`). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** `realpath -m`: resolve symlinks in the existing part of the path, keep the rest as written. */
function resolveReal(p: string): string {
  let existing = path.resolve(p);
  const rest: string[] = [];
  while (!existsSync(existing) && path.dirname(existing) !== existing) {
    rest.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  return path.join(realpathSync(existing), ...rest);
}

/** The real path of a scratch dir, or exit if it is not strictly inside SCRATCH_ROOT. */
export function scratchDirToDelete(dir: string): string {
  const root = resolveReal(SCRATCH_ROOT);
  const real = resolveReal(dir);
  if (!real.startsWith(root + path.sep)) die(`refusing to delete ${dir}: not inside ${SCRATCH_ROOT}`);
  return real;
}

/** `export K='V'` lines, the format `eval "$($V env)"` consumes. */
export function writeEnvFile(file: string, vars: Record<string, string>): void {
  writeFileSync(file, Object.entries(vars).map(([k, v]) => `export ${k}='${v}'\n`).join(""));
}

export function readEnvFile(file: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const m of (readText(file) ?? "").matchAll(/^export ([A-Za-z_][A-Za-z0-9_]*)='(.*)'$/gm)) {
    vars[m[1]] = m[2];
  }
  return vars;
}

/** A shell-quoted command line for command.txt evidence. */
export function shellQuote(args: string[]): string {
  return args
    .map((a) => (/^[A-Za-z0-9_/.,:=@%+-]+$/.test(a) ? a : `'${a.replaceAll("'", `'\\''`)}'`))
    .join(" ");
}

/** Print to stdout and append to a file (`| tee -a`). */
export function teeAppend(file: string, line: string): void {
  console.log(line);
  writeFileSync(file, `${line}\n`, { flag: "a" });
}

/** `ls dir`, one name per line. */
export function listDir(dir: string): void {
  for (const name of readdirSync(dir).sort()) console.log(name);
}

export function tail(file: string, lines: number): void {
  const text = readText(file) ?? "";
  const all = text.replace(/\n$/, "").split("\n");
  console.log(all.slice(-lines).join("\n"));
}

/** HTTP GET/POST that never throws: `{ ok, status, text }`, status 0 on a network error. */
export async function http(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; text: string; error?: string }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init.timeoutMs ?? 60000) });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, text: "", error: e instanceof Error ? e.message : String(e) };
  }
}

export function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A string field of parsed JSON text, or undefined if the text is not JSON or lacks it. */
export function jsonString(text: string, key: string): string | undefined {
  try {
    const v: unknown = JSON.parse(text);
    if (isRecord(v) && typeof v[key] === "string") return v[key];
  } catch {}
  return undefined;
}
