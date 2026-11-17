#!/usr/bin/env node
// verify-docs: launch, inspect, drive, and tear down an ISOLATED instance of the docs and
// landing site (packages/docs) for verification runs.
// Run directly (`./verify-docs.ts ...` or `node verify-docs.ts ...`); Node >= 24 strips the types.
import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  AGENT_BROWSER_HINT,
  REPO,
  SCRATCH_ROOT,
  STATE_DIR,
  type RunId,
  agentBrowserVersion,
  browserSession,
  closeBrowser,
  defaultRunId,
  die,
  freePort,
  http,
  isAlive,
  claimScratch,
  listDir,
  lockLifecycle,
  parseRunId,
  portPids,
  printBrowserEnv,
  readEnvFile,
  readPointer,
  readText,
  required,
  run,
  runToFiles,
  scratchDirToDelete,
  shellQuote,
  sleep,
  stamp,
  teeAppend,
  writeEnvFile,
} from "../../verify-shared/common.ts";

const USAGE = `# verify-docs: launch, inspect, drive, and tear down an ISOLATED copy of the docs and
# landing site (packages/docs) for verification runs.
#
#   verify-docs launch [--prod] [RUN_ID]   # start on a free loopback port, wait until a page and a docs page render
#   verify-docs doctor                     # read-only: is this run's server worth driving?
#   verify-docs env                        # print the export lines for the current run
#   verify-docs http <label> <path> [--accept TYPE] [--head] [--status N] [--contains TEXT]...
#                                          # recorded GET for non-browser endpoints, exit 1 if an expectation fails
#   verify-docs net [label]                # classify the browser's network log; exit 1 on an unexpected destination
#   verify-docs browser-env                # export lines for agent-browser: AGENT_BROWSER_SESSION, DOCS, SHOTS, ab_save
#   verify-docs cleanup                    # stop this run's server and browser, delete scratch, KEEP evidence
#
# State: the current run id lives in $REPO/.verify-everr/current-docs.
# Scratch (deleted by cleanup):  \${EVERR_VERIFY_SCRATCH:-/tmp/verify-everr}/docs-<RUN_ID>/
# Evidence (never deleted):      $REPO/.verify-everr/artifacts/docs-<RUN_ID>/`;

const CURRENT = path.join(STATE_DIR, "current-docs");
const DOCS_DIR = path.join(REPO, "packages/docs");
const VP = path.join(DOCS_DIR, "node_modules/.bin/vp");
const PROD_ENTRY = path.join(DOCS_DIR, ".output/server/index.mjs");
// Discard port: nothing listens, so a request to it fails at once and leaves the machine.
const DEAD_SINK = "http://127.0.0.1:9";
const GITHUB_STARS = "https://api.github.com/repos/everr-labs/everr";
const HOME_TITLE = "Everr - Observability made simple";
const DOCS_PROBE = { path: "/docs/learn/install", text: "Installation" };

type Run = {
  id: RunId;
  dir: string;
  art: string;
  vars: Record<string, string>;
  origin: string;
  port: string;
  mode: "dev" | "prod";
};

const runDir = (id: string) => path.join(SCRATCH_ROOT, `docs-${id}`);
const artDir = (id: string) => path.join(STATE_DIR, "artifacts", `docs-${id}`);

function loadRun(): Run {
  const id = process.env.RUN_ID || readPointer(CURRENT);
  if (!id) die("no current run; run 'verify-docs launch' first");
  const runId = parseRunId(id);
  const dir = runDir(runId);
  const envFile = path.join(dir, "env");
  if (!existsSync(envFile)) die(`run ${runId} has no env file at ${envFile} (already cleaned up?)`);
  const vars = readEnvFile(envFile);
  const { DOCS_ORIGIN: origin, DOCS_PORT: port, DOCS_MODE: mode } = vars;
  if (!origin || !port || (mode !== "dev" && mode !== "prod")) die(`${envFile} is missing the run's origin, port or mode`);
  return { id: runId, dir, art: artDir(runId), vars, origin, port, mode };
}

/** The recorded server process: its pid is also its process group id (spawned detached). */
function recorded(r: Pick<Run, "dir">): { pid: number; marker: string } | undefined {
  const text = readText(path.join(r.dir, "server.pid"));
  const m = text?.match(/^pid=(\d+)\nmarker=(.*)$/m);
  return m ? { pid: Number(m[1]), marker: m[2] } : undefined;
}

/** True only for the process this run started: the group leader, still running our command. */
function ownsGroup(pid: number, marker: string): boolean {
  if (pid <= 0 || !isAlive(pid)) return false;
  const ps = run("ps", ["-o", "pgid=,command=", "-p", String(pid)]).stdout.trim();
  const m = ps.match(/^(\d+)\s+(.*)$/);
  return Boolean(m) && Number(m?.[1]) === pid && Boolean(m?.[2].includes(marker));
}

function groupMembers(pgid: number): number[] {
  const rows = run("ps", ["-A", "-o", "pid=,pgid="]).stdout.split("\n");
  return rows.flatMap((row) => {
    const [p, g] = row.trim().split(/\s+/).map(Number);
    return g === pgid ? [p] : [];
  });
}

/** The processes cleanup may stop. A pid is not reused while its process group has members, so the
 * survivors of a leader that exited (the vite child that owns the port) are still this run's. */
function ourGroup(pid: number, marker: string): number[] {
  if (ownsGroup(pid, marker)) return groupMembers(pid);
  return isAlive(pid) ? [] : groupMembers(pid);
}

const secs = (ms: number) => (ms / 1000).toFixed(1);

async function waitFor(what: string, timeoutMs: number, probe: () => Promise<boolean>, failed: () => string | undefined): Promise<number> {
  const start = Date.now();
  for (;;) {
    if (await probe()) return Date.now() - start;
    const why = failed();
    if (why) die(`${what}: ${why}`);
    if (Date.now() - start > timeoutMs) die(`${what} not ready within ${secs(timeoutMs)}s`);
    await sleep(500);
  }
}

async function cmdLaunch(args: string[]): Promise<number> {
  const prod = args.includes("--prod");
  const positional = args.filter((a) => a !== "--prod");
  if (!existsSync(VP)) die(`${VP} missing; run 'pnpm install' at the repo root`);
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 23) die(`node ${process.version} is too old; the repo uses Node 24. Put Node 24 first on PATH`);
  lockLifecycle(CURRENT);
  const live = readPointer(CURRENT);
  if (live && existsSync(path.join(runDir(live), "env"))) {
    die(`run ${live} is still live; run 'verify-docs cleanup' first (one server per checkout)`);
  }
  const id = parseRunId(positional[0] || defaultRunId());
  const dir = runDir(id);
  const art = artDir(id);
  claimScratch(dir);
  mkdirSync(art, { recursive: true });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  // The page reports to PostHog and to the Everr ingest endpoint. Without a key the SDK sends dev
  // builds to the local collector at 127.0.0.1:54418, which may be a real instance, so both are
  // pointed at a dead port. A production build bakes these values in, so they are set before it too.
  const sinks = {
    VITE_POSTHOG_PROJECT_TOKEN: "phc_verify_disabled",
    VITE_POSTHOG_HOST: DEAD_SINK,
    VITE_EVERR_INGEST_ENDPOINT: DEAD_SINK,
    VITE_EVERR_PUBLIC_INGEST_KEY: "",
  };
  const mode = prod ? "prod" : "dev";
  writeEnvFile(path.join(dir, "env"), { RUN_ID: id, DOCS_ORIGIN: origin, DOCS_PORT: String(port), DOCS_MODE: mode, ...sinks });
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(CURRENT, `${id}\n`);
  const childEnv = { ...process.env, ...sinks };
  const log = path.join(dir, "docs.log");
  let buildSeconds = "";
  if (prod) {
    const started = Date.now();
    const rc = runToFiles(VP, ["build"], { stdout: path.join(dir, "build.log") }, { env: childEnv, cwd: DOCS_DIR });
    buildSeconds = secs(Date.now() - started);
    if (rc !== 0 || !existsSync(PROD_ENTRY)) {
      copyFileSync(path.join(dir, "build.log"), path.join(art, "build.log"));
      die(`vp build exited ${rc} (see ${art}/build.log); run 'verify-docs cleanup'`);
    }
  }
  const [cmd, cmdArgs, marker, extraEnv]: [string, string[], string, Record<string, string>] = prod
    ? [process.execPath, [PROD_ENTRY], "index.mjs", { PORT: String(port), NITRO_HOST: "127.0.0.1" }]
    : [VP, ["dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], `--port ${port}`, {}];
  const fd = openSync(log, "w");
  // Detached makes the child its own process group leader: cleanup stops the whole group
  // (vp dev forks the vite process that owns the port) and nothing else.
  const child = spawn(cmd, cmdArgs, { cwd: DOCS_DIR, env: { ...childEnv, ...extraEnv }, detached: true, stdio: ["ignore", fd, fd] });
  closeSync(fd);
  child.unref();
  const pid = child.pid;
  if (!pid) die("could not start the server");
  writeFileSync(path.join(dir, "server.pid"), `pid=${pid}\nmarker=${marker}\n`);
  writeFileSync(
    path.join(art, "run.txt"),
    [
      `run_id: ${id}`,
      `mode: ${mode}${prod ? ` (vp build ${buildSeconds}s)` : ""}`,
      `origin: ${origin}`,
      `command: ${shellQuote([cmd, ...cmdArgs])}`,
      `server_pid: ${pid} (process group leader)`,
      `analytics_sinks: PostHog and Everr ingest -> ${DEAD_SINK}`,
      `git_head: ${run("git", ["-C", REPO, "rev-parse", "HEAD"]).stdout.trim()}`,
      `git_branch: ${run("git", ["-C", REPO, "rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim()}`,
      `node: ${process.version}`,
      `launched_at: ${stamp()}`,
      "",
    ].join("\n"),
  );
  console.log(`launching ${mode} run ${id} (scratch ${dir}, evidence ${art})`);
  const exited = () => (isAlive(pid) ? undefined : `server exited early, last log lines:\n${tailText(log, 15)}`);
  const renders = (url: string, expect: string) => async () => {
    const res = await http(url, { timeoutMs: 120000 });
    return res.status === 200 && res.text.includes(expect);
  };
  // The dev server compiles a route when it is first requested, so each wait is bounded by 120s.
  const homeMs = await waitFor("landing page", 120000, renders(`${origin}/`, HOME_TITLE), exited);
  const docsMs = await waitFor("docs page", 120000, renders(`${origin}${DOCS_PROBE.path}`, DOCS_PROBE.text), exited);
  const holders = portPids(port);
  const stray = holders.split(" ").filter(Boolean).filter((p) => !groupMembers(pid).includes(Number(p)));
  writeFileSync(path.join(dir, "listeners"), `${holders}\n`);
  if (stray.length) die(`port ${port} is held by ${stray.join(" ")}, outside the server's process group; run 'verify-docs cleanup'`);
  copyFileSync(path.join(dir, "env"), path.join(art, "run.env"));
  console.log(`first render: / ${secs(homeMs)}s, ${DOCS_PROBE.path} ${secs(docsMs)}s${prod ? ` (build ${buildSeconds}s)` : "; later routes compile on first visit"}`);
  console.log(`DOCS READY run=${id} origin=${origin}`);
  return 0;
}

function tailText(file: string, lines: number): string {
  const text = (readText(file) ?? "").replace(/\n$/, "").split("\n");
  return text.slice(-lines).join("\n");
}

async function cmdDoctor(): Promise<number> {
  const r = loadRun();
  let ok = true;
  const check = (label: string, pass: boolean) => {
    console.log(`${pass ? "ok  " : "FAIL"} ${label}`);
    if (!pass) ok = false;
  };
  console.log(`run: ${r.id}  mode: ${r.mode}  origin: ${r.origin}`);
  const proc = recorded(r);
  check("server process is the one this run started (group leader, our command)", Boolean(proc) && ownsGroup(proc?.pid ?? 0, proc?.marker ?? ""));
  const holders = portPids(r.port).split(" ").filter(Boolean).map(Number);
  const members = proc ? groupMembers(proc.pid) : [];
  check(`port ${r.port} is held only by the run's process group [${holders.join(" ")}]`, holders.length > 0 && holders.every((p) => members.includes(p)));
  const home = await http(`${r.origin}/`);
  check(`GET / is 200 and titled '${HOME_TITLE}'`, home.status === 200 && home.text.includes(`<title>${HOME_TITLE}</title>`));
  const docs = await http(`${r.origin}${DOCS_PROBE.path}`);
  check(`GET ${DOCS_PROBE.path} is 200 and renders '${DOCS_PROBE.text}'`, docs.status === 200 && docs.text.includes(DOCS_PROBE.text));
  const md = await http(`${r.origin}/docs.md`);
  check("GET /docs.md is 200 Markdown", md.status === 200 && md.text.startsWith("#"));
  check(`analytics sinks are the dead port (${DEAD_SINK})`, ["VITE_POSTHOG_HOST", "VITE_EVERR_INGEST_ENDPOINT"].every((k) => r.vars[k] === DEAD_SINK) && (r.vars.VITE_EVERR_PUBLIC_INGEST_KEY ?? "") === "");
  const ab = agentBrowserVersion();
  check(ab ? `agent-browser on PATH (${ab})` : `agent-browser on PATH (missing; ${AGENT_BROWSER_HINT})`, Boolean(ab));
  if (r.mode === "dev") {
    const log = (readText(path.join(r.dir, "docs.log")) ?? "").replace(/\u001b\[[0-9;]*m/g, "");
    // Browser console output is forwarded into this log, and the dead analytics sink makes PostHog log "Failed to fetch" on purpose
    check("dev server log has no server-side errors", !/Internal server error|Pre-transform error|\(ssr\)[^\n]*\[(error|console\.error)\]/.test(log));
  }
  if (ok) {
    console.log("DOCS DOCTOR OK");
    return 0;
  }
  console.log("DOCS DOCTOR FAILED");
  return 1;
}

function cmdEnv(): number {
  process.stdout.write(readText(path.join(loadRun().dir, "env")) ?? "");
  return 0;
}

/** verify-docs http <label> <path> [--accept T] [--head] [--status N] [--contains TEXT]...: recorded request, checked expectations. */
async function cmdHttp(args: string[]): Promise<number> {
  const r = loadRun();
  const label = required(args[0], "label");
  const urlPath = required(args[1], "path");
  let accept: string | undefined;
  let head = false;
  let wantStatus: number | undefined;
  const contains: string[] = [];
  for (let i = 2; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--head") head = true;
    else if (flag === "--accept") accept = required(args[++i], "--accept value");
    else if (flag === "--status") wantStatus = Number(required(args[++i], "--status value"));
    else if (flag === "--contains") contains.push(required(args[++i], "--contains value"));
    else die(`unknown flag ${flag}`);
  }
  const out = path.join(r.art, "http", label);
  mkdirSync(out, { recursive: true });
  const url = `${r.origin}${urlPath}`;
  const headers: Record<string, string> = accept ? { Accept: accept } : {};
  const command = shellQuote(["curl", ...(head ? ["-I"] : []), ...(accept ? ["-H", `Accept: ${accept}`] : []), url]);
  writeFileSync(path.join(out, "command.txt"), `${command}\n`);
  let res: Response;
  try {
    res = await fetch(url, { method: head ? "HEAD" : "GET", headers, redirect: "manual", signal: AbortSignal.timeout(120000) });
  } catch (e) {
    console.error(`verify-docs: ${url}: ${e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e)}`);
    return 1;
  }
  const body = Buffer.from(await res.arrayBuffer()).toString("utf8");
  const headerText = [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n");
  writeFileSync(path.join(out, "status"), `${res.status}\n`);
  writeFileSync(path.join(out, "headers"), `${headerText}\n`);
  writeFileSync(path.join(out, "body"), body);
  const verdicts: string[] = [];
  if (wantStatus !== undefined) verdicts.push(`${res.status === wantStatus ? "ok  " : "FAIL"} status ${res.status} (want ${wantStatus})`);
  for (const text of contains) verdicts.push(`${body.includes(text) ? "ok  " : "FAIL"} body contains ${JSON.stringify(text)}`);
  writeFileSync(path.join(out, "verdict.txt"), `${verdicts.join("\n")}\n`);
  console.log(`$ ${command}`);
  console.log(`status ${res.status}`);
  for (const k of ["content-type", "vary", "location", "content-length"]) {
    const v = res.headers.get(k);
    if (v) console.log(`${k}: ${v}`);
  }
  console.log(`--- body (${body.length} bytes, first 12 lines; full body in ${out}/body)`);
  console.log(body.split("\n").slice(0, 12).map((l) => (l.length > 200 ? `${l.slice(0, 200)}...` : l)).join("\n"));
  if (verdicts.length) console.log(`--- checks\n${verdicts.join("\n")}`);
  return verdicts.some((v) => v.startsWith("FAIL")) ? 1 : 0;
}

/** verify-docs net [label]: where did the browser send requests? Anything beyond the app, the dead sink and the GitHub star count fails. */
function cmdNet(label: string | undefined): number {
  const r = loadRun();
  const name = label || "net";
  const listed = run("agent-browser", ["--session", browserSession(`docs-${r.id}`), "network", "requests"]);
  if (listed.status !== 0) die(`agent-browser network requests failed: ${listed.stderr.trim() || listed.stdout.trim()}`);
  const out = path.join(r.art, "net");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, `${name}.requests.txt`), listed.stdout);
  const buckets: Record<"app" | "dead-sink" | "github-stars" | "unexpected", string[]> = { app: [], "dead-sink": [], "github-stars": [], unexpected: [] };
  for (const line of listed.stdout.split("\n")) {
    if (!line.trim() || /^No requests captured/i.test(line.trim())) continue;
    // `[id] METHOD URL (type) status`; the id prefix is optional so a build that omits it still parses.
    const m = line.match(/^(?:\[\S+\] )?([A-Z]+) (\S+)/);
    // A line this does not understand could hide a request, so it fails the audit instead of passing it.
    if (!m) die(`cannot parse this 'agent-browser network requests' line (output format changed?): ${line}`);
    const url = m[2];
    if (url.startsWith("data:") || url.startsWith("blob:")) continue;
    if (url.startsWith(`${r.origin}/`)) buckets.app.push(line);
    else if (url.startsWith(`${DEAD_SINK}/`)) buckets["dead-sink"].push(line);
    else if (url === GITHUB_STARS) buckets["github-stars"].push(line);
    else buckets.unexpected.push(line);
  }
  const summary = `NET app=${buckets.app.length} dead-sink=${buckets["dead-sink"].length} github-stars=${buckets["github-stars"].length} unexpected=${buckets.unexpected.length}`;
  const detail = [
    summary,
    ...buckets["dead-sink"].map((l) => `dead-sink  ${l}`),
    ...buckets["github-stars"].map((l) => `github     ${l}`),
    ...buckets.unexpected.map((l) => `UNEXPECTED ${l}`),
  ];
  writeFileSync(path.join(out, `${name}.summary.txt`), `${detail.join("\n")}\n`);
  console.log(detail.join("\n"));
  if (!buckets["dead-sink"].length) console.log("NOTE no request reached the dead sink: the SDKs had not flushed yet, so this proves nothing. Wait 10s and run again");
  return buckets.unexpected.length ? 1 : 0;
}

function cmdBrowserEnv(): number {
  const r = loadRun();
  return printBrowserEnv(
    {
      AGENT_BROWSER_SESSION: browserSession(`docs-${r.id}`),
      // A failed wait costs this long; pass --timeout 90000 to a wait that follows a first visit
      AGENT_BROWSER_DEFAULT_TIMEOUT: "30000",
      DOCS: r.origin,
      // True once React has hydrated the page: server HTML shows text before it, and a click before it does nothing
      HYDRATED: 'Boolean(document.querySelector("#nd-nav")) && Object.keys(document.querySelector("#nd-nav")).some(k => k.startsWith("__reactFiber"))',
    },
    path.join(r.art, "web"),
  );
}

async function cmdCleanup(): Promise<number> {
  lockLifecycle(CURRENT);
  const id = process.env.RUN_ID || readPointer(CURRENT);
  if (!id) {
    console.log("nothing to clean up");
    return 0;
  }
  const runId = parseRunId(id);
  const dir = runDir(runId);
  const art = artDir(runId);
  const toDelete = scratchDirToDelete(dir);
  mkdirSync(art, { recursive: true });
  const stopLog = path.join(art, "cleanup.stop.txt");
  const proc = recorded({ dir });
  const envFile = path.join(dir, "env");
  const port = existsSync(envFile) ? readEnvFile(envFile).DOCS_PORT : undefined;
  const members = proc ? ourGroup(proc.pid, proc.marker) : [];
  if (proc && members.length) {
    teeAppend(stopLog, `stopping process group ${proc.pid} [${members.join(" ")}]`);
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {}
    const deadline = Date.now() + 10000;
    while (groupMembers(proc.pid).length > 0 && Date.now() < deadline) await sleep(300);
    if (groupMembers(proc.pid).length > 0) {
      teeAppend(stopLog, `group ${proc.pid} still running after 10s, sending SIGKILL`);
      try {
        process.kill(-proc.pid, "SIGKILL");
      } catch {}
      await sleep(500);
    }
  } else if (proc) {
    teeAppend(stopLog, `server pid ${proc.pid} is not running our command (already stopped, or the pid was reused); not killing it`);
  }
  await closeBrowser(browserSession(`docs-${runId}`), stopLog);
  for (const f of ["docs.log", "build.log"]) {
    if (existsSync(path.join(dir, f))) copyFileSync(path.join(dir, f), path.join(art, f));
  }
  const held = port ? portPids(port) : "";
  if (held) {
    teeAppend(stopLog, `port ${port} still held by ${held}, outside the recorded process group, so not ours to kill; scratch kept. Stop it and rerun cleanup.`);
    return 1;
  }
  rmSync(toDelete, { recursive: true, force: true });
  if (readPointer(CURRENT) === runId) rmSync(CURRENT, { force: true });
  console.log(`cleaned up run ${runId}; evidence kept at ${art}`);
  listDir(art);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "launch":
      return cmdLaunch(args);
    case "doctor":
      return cmdDoctor();
    case "env":
      return cmdEnv();
    case "http":
      return cmdHttp(args);
    case "net":
      return cmdNet(args[0]);
    case "browser-env":
      return cmdBrowserEnv();
    case "cleanup":
      return cmdCleanup();
    default:
      console.log(USAGE);
      return 2;
  }
}

process.exit(await main(process.argv.slice(2)));
