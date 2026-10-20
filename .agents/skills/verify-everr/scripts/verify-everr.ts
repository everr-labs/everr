#!/usr/bin/env node
// verify-everr: launch, inspect, drive, and tear down an ISOLATED everr-dev local instance
// (collector + chDB + local UI), and the web app (web.ts), for verification runs.
// Run directly (`./verify-everr.ts ...` or `node verify-everr.ts ...`); Node >= 23 strips the types.
import { type Dirent, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { shot } from "./browser.ts";
import {
  BIN,
  REPO,
  SCRATCH_ROOT,
  STATE_DIR,
  type RunId,
  defaultRunId,
  die,
  findChrome,
  freePort,
  http,
  isExecutable,
  jsonString,
  listDir,
  parseRunId,
  portOf,
  portPids,
  readEnvFile,
  readPointer,
  readText,
  required,
  run,
  runInherit,
  runToFiles,
  scratchDirToDelete,
  shellQuote,
  sleep,
  stamp,
  teeAppend,
  which,
  writeEnvFile,
} from "./common.ts";
import { WEB_COMMANDS, WEB_USAGE } from "./web.ts";

const USAGE = `# verify-everr: launch, inspect, drive, and tear down an ISOLATED everr-dev
# local instance (collector + chDB + local UI) for verification runs.
#
#   verify-everr build                  # pnpm dev:cli (local UI + Go collector + chDB + debug CLI)
#   verify-everr launch [RUN_ID]        # start an isolated detached instance, wait until queryable
#   verify-everr doctor                 # read-only: is this run's instance worth driving?
#   verify-everr env                    # print the export lines for the current run
#   verify-everr cli <label> -- ARGS... # run everr-dev ARGS in the run's env, record evidence
#   verify-everr cli-until <label> <text> -- ARGS... # retry a read until stdout has text
#   verify-everr ui-get <path>          # GET a path on this run's local UI
#   verify-everr ui-cmd <command> [json]# POST /api/commands/<command> like the browser does
#   verify-everr ui-shot <label> <path> [text] # headless Chrome: wait for text, save screenshot/DOM/innerText
#   verify-everr cleanup                # stop this run's instance, delete scratch, KEEP evidence
#   verify-everr web-*                  # web app (packages/app) commands, below
#
# State: the current run id lives in $REPO/.verify-everr/current.
# Scratch (deleted by cleanup):  \${EVERR_VERIFY_SCRATCH:-/tmp/verify-everr}/<RUN_ID>/
# Evidence (never deleted):      $REPO/.verify-everr/artifacts/<RUN_ID>/`;

const CURRENT = path.join(STATE_DIR, "current");

type Run = {
  id: RunId;
  dir: string;
  art: string;
  /** The run's env file, applied to every everr-dev call. */
  vars: Record<string, string>;
  sql: string;
  otlp: string;
  ui: string;
};

const runDir = (id: string) => path.join(SCRATCH_ROOT, id);
const artDir = (id: string) => path.join(STATE_DIR, "artifacts", id);
const envWith = (vars: Record<string, string>): NodeJS.ProcessEnv => ({ ...process.env, ...vars });

function loadRun(): Run {
  const fromEnv = process.env.RUN_ID;
  let id: string;
  if (fromEnv) id = fromEnv;
  else {
    if (!existsSync(CURRENT)) die("no current run; run 'verify-everr launch' first");
    id = readPointer(CURRENT);
  }
  const runId = parseRunId(id);
  const dir = runDir(runId);
  const envFile = path.join(dir, "env");
  if (!existsSync(envFile)) die(`run ${runId} has no env file at ${envFile} (already cleaned up?)`);
  const vars = readEnvFile(envFile);
  const { EVERR_SQL_HTTP_ORIGIN: sql, EVERR_OTLP_HTTP_ORIGIN: otlp, EVERR_LOCAL_UI_ORIGIN: ui } = vars;
  if (!sql || !otlp || !ui) die(`${envFile} is missing the run's origins`);
  return { id: runId, dir, art: artDir(runId), vars, sql, otlp, ui };
}

const everr = (r: Run, args: string[]) => run(BIN, args, { env: envWith(r.vars) });

function cmdBuild(): number {
  if (!which("make")) die("make is missing (collector build-local needs it)");
  if (!which("go")) die("go is missing (collector needs Go >= go.mod version)");
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor < 23) {
    die(`node ${process.version} is too old; repo pins ${(readText(path.join(REPO, ".nvmrc")) ?? "").trim()} (.nvmrc). Put Node 24 first on PATH`);
  }
  if (!existsSync(path.join(REPO, "node_modules"))) {
    const rc = runInherit("pnpm", ["install", "--frozen-lockfile"], { cwd: REPO });
    if (rc !== 0) return rc;
  }
  // The build reports its own spans over OTLP (packages/cli/scripts/build-telemetry.ts), by default
  // to 127.0.0.1:54318, which may be a real local collector. OTEL_EXPORTER_OTLP_ENDPOINT is the only
  // knob outside CI; point it at a dead port unless VERIFY_BUILD_OTLP_ENDPOINT names a sink.
  const endpoint = process.env.VERIFY_BUILD_OTLP_ENDPOINT || "http://127.0.0.1:9";
  const rc = runInherit("pnpm", ["dev:cli"], { cwd: REPO, env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: endpoint } });
  if (rc !== 0) return rc;
  if (!isExecutable(BIN)) die(`build finished but ${BIN} is missing`);
  return runInherit(BIN, ["--version"]);
}

async function cmdLaunch(arg: string | undefined): Promise<number> {
  if (!isExecutable(BIN)) die(`${BIN} missing; run 'verify-everr build' first`);
  const live = readPointer(CURRENT);
  if (live && existsSync(path.join(runDir(live), "env"))) {
    die(`run ${live} is still live; run 'verify-everr cleanup' first (one instance per checkout)`);
  }
  const id = parseRunId(arg || defaultRunId());
  const dir = runDir(id);
  const art = artDir(id);
  for (const sub of ["home", "telemetry", "logs", "config", "data", "cache", "state"]) {
    mkdirSync(path.join(dir, sub), { recursive: true });
  }
  mkdirSync(art, { recursive: true });
  const sql = `http://127.0.0.1:${await freePort()}`;
  const otlp = `http://127.0.0.1:${await freePort()}`;
  const ui = `http://127.0.0.1:${await freePort()}`;
  writeEnvFile(path.join(dir, "env"), {
    RUN_ID: id,
    EVERR_SQL_HTTP_ORIGIN: sql,
    EVERR_OTLP_HTTP_ORIGIN: otlp,
    EVERR_LOCAL_UI_ORIGIN: ui,
    EVERR_TELEMETRY_DIR: path.join(dir, "telemetry"),
    EVERR_LOCAL_LOG_DIR: path.join(dir, "logs"),
    EVERR_INTERNAL_TELEMETRY_ENDPOINT: otlp,
    HOME: path.join(dir, "home"),
    XDG_CONFIG_HOME: path.join(dir, "config"),
    XDG_DATA_HOME: path.join(dir, "data"),
    XDG_CACHE_HOME: path.join(dir, "cache"),
    XDG_STATE_HOME: path.join(dir, "state"),
  });
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(CURRENT, `${id}\n`);
  copyFileSync(path.join(dir, "env"), path.join(art, "run.env"));
  writeFileSync(
    path.join(art, "run.txt"),
    [
      `run_id: ${id}`,
      `git_head: ${run("git", ["-C", REPO, "rev-parse", "HEAD"]).stdout.trim()}`,
      `git_branch: ${run("git", ["-C", REPO, "rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim()}`,
      `binary: ${BIN}`,
      `binary_version: ${run(BIN, ["--version"]).stdout.trim()}`,
      `binary_mtime: ${stamp(BIN)}`,
      `launched_at: ${stamp()}`,
      "",
    ].join("\n"),
  );
  const r = loadRun();
  console.log(`launching run ${id} (scratch ${dir}, evidence ${art})`);
  const rc = runToFiles(BIN, ["local", "start", "--detach", "--no-open"], {
    stdout: path.join(art, "launch.stdout"),
    stderr: path.join(art, "launch.stderr"),
  }, { env: envWith(r.vars) });
  writeFileSync(path.join(art, "launch.exit"), `${rc}\n`);
  process.stdout.write(readText(path.join(art, "launch.stdout")) ?? "");
  if (rc !== 0) {
    process.stderr.write(readText(path.join(art, "launch.stderr")) ?? "");
    die(`local start exited ${rc} (see ${dir}/logs/local.log); run 'verify-everr cleanup'`);
  }
  // Ready means queryable, not just listening: wait until SQL over the tables answers.
  const deadline = Date.now() + 60000;
  while (everr(r, ["local", "query", "SELECT count() AS c FROM logs", "--format", "ndjson"]).status !== 0) {
    if (Date.now() >= deadline) die(`instance never answered SQL within 60s; see ${dir}/logs/local.log`);
    await sleep(500);
  }
  // Record the PIDs that own our ports so cleanup can kill exactly what we started.
  const pids = [
    `sql_pids=${portPids(portOf(sql))}`,
    `otlp_pids=${portPids(portOf(otlp))}`,
    `ui_pids=${portPids(portOf(ui))}`,
    "",
  ].join("\n");
  writeFileSync(path.join(dir, "pids"), pids);
  writeFileSync(path.join(art, "pids.txt"), pids);
  console.log(`READY run=${id} ui=${ui} sql=${sql} otlp=${otlp}`);
  return 0;
}

/** Up to `limit` files under dirs modified after the binary (`find -newer`). */
function newerThan(dirs: string[], mtimeMs: number, limit: number): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (found.length >= limit) return;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && statSync(p).mtimeMs > mtimeMs) found.push(p);
    }
  };
  for (const d of dirs) walk(d);
  return found;
}

async function cmdDoctor(): Promise<number> {
  const r = loadRun();
  let ok = true;
  const check = (label: string, pass: boolean) => {
    console.log(`${pass ? "ok  " : "FAIL"} ${label}`);
    if (!pass) ok = false;
  };
  const version = run(BIN, ["--version"]);
  console.log(`run: ${r.id}`);
  console.log(`binary: ${version.status === 0 ? version.stdout.trim() : "missing"}  head: ${run("git", ["-C", REPO, "rev-parse", "--short", "HEAD"]).stdout.trim()}`);
  const binMtime = existsSync(BIN) ? statSync(BIN).mtimeMs : 0;
  const stale = newerThan(["packages/cli/src", "packages/local-app/src", "collector/cmd"].map((d) => path.join(REPO, d)), binMtime, 3);
  if (stale.length) {
    console.log("WARN sources newer than binary (rebuild with 'verify-everr build'):");
    for (const f of stale) console.log(`       ${f}`);
  }
  check("binary is a debug build", version.stdout.includes("debug build"));
  check("local status exits 0 (collector+ui same instance)", everr(r, ["local", "status"]).status === 0);
  const collector = await http(`${r.sql}/health`);
  const uiHealth = await http(`${r.ui}/health`);
  const cid = collector.ok ? jsonString(collector.text, "instance_id") : undefined;
  const uid = uiHealth.ok ? jsonString(uiHealth.text, "instance_id") : undefined;
  check(`collector /health and ui /health share instance_id (${cid ?? ""})`, Boolean(cid) && cid === uid);
  check("collector service identity", collector.ok && jsonString(collector.text, "service") === "everr-local-collector");
  const recorded = readText(path.join(r.dir, "pids")) ?? "";
  for (const [name, origin] of [["sql", r.sql], ["otlp", r.otlp], ["ui", r.ui]]) {
    const want = recorded.match(new RegExp(`^${name}_pids=(.*)$`, "m"))?.[1].trim() ?? "";
    const now = portPids(portOf(origin));
    check(`${name} port ${portOf(origin)} owned by recorded pids [${want}]`, want !== "" && want === now);
  }
  check("SQL answers (SELECT count() FROM logs)", everr(r, ["local", "query", "SELECT count() AS c FROM logs", "--format", "ndjson"]).status === 0);
  if (ok) {
    console.log("DOCTOR OK");
    return 0;
  }
  console.log("DOCTOR FAILED");
  return 1;
}

function cmdEnv(): number {
  process.stdout.write(readText(path.join(loadRun().dir, "env")) ?? "");
  return 0;
}

/** Drop a leading `--` separator. */
const afterDashes = (args: string[]) => (args[0] === "--" ? args.slice(1) : args);

/** verify-everr cli <label> -- everr args...: run everr-dev in the run's env, record evidence. */
function cmdCli(r: Run, label: string, args: string[], quiet = false): number {
  const out = path.join(r.art, "cli", label);
  mkdirSync(out, { recursive: true });
  const command = shellQuote(["everr", ...args]);
  writeFileSync(path.join(out, "command.txt"), `${command}\n`);
  const rc = runToFiles(BIN, args, { stdout: path.join(out, "stdout"), stderr: path.join(out, "stderr") }, {
    env: envWith(r.vars),
    cwd: process.env.VERIFY_CWD || REPO,
  });
  writeFileSync(path.join(out, "exit_code"), `${rc}\n`);
  writeFileSync(path.join(out, "at.txt"), `${stamp()}\n`);
  if (!quiet) {
    console.log(`$ ${command}`);
    process.stdout.write(readText(path.join(out, "stdout")) ?? "");
    const stderr = readText(path.join(out, "stderr")) ?? "";
    if (stderr) {
      console.log("--- stderr");
      process.stdout.write(stderr);
    }
    console.log(`--- exit ${rc}  (evidence: ${out})`);
  }
  return rc;
}

/** Re-run a read-only CLI command until stdout contains <text> (ingestion is async), max $UNTIL_S (15s). */
async function cmdCliUntil(r: Run, label: string, want: string, args: string[]): Promise<number> {
  const start = Date.now();
  const deadline = start + Number(process.env.UNTIL_S || 15) * 1000;
  const out = path.join(r.art, "cli", label);
  const secs = () => Math.floor((Date.now() - start) / 1000);
  let tries = 0;
  for (;;) {
    tries++;
    if (cmdCli(r, label, args, true) === 0 && (readText(path.join(out, "stdout")) ?? "").includes(want)) {
      const line = `found '${want}' after ${tries} tries (${secs()}s)`;
      console.log(line);
      writeFileSync(path.join(out, "until.txt"), `${line}\n`);
      process.stdout.write(readText(path.join(out, "stdout")) ?? "");
      return 0;
    }
    if (Date.now() >= deadline) break;
    await sleep(500);
  }
  const line = `NOT FOUND '${want}' after ${tries} tries (${secs()}s)`;
  console.log(line);
  writeFileSync(path.join(out, "until.txt"), `${line}\n`);
  process.stdout.write((readText(path.join(out, "stdout")) ?? "") + (readText(path.join(out, "stderr")) ?? ""));
  return 1;
}

/** Print a response body like `curl -sS`; a network error goes to stderr with exit 1. */
async function printResponse(url: string, init: RequestInit = {}): Promise<number> {
  try {
    const res = await fetch(url, init);
    process.stdout.write(Buffer.from(await res.arrayBuffer()));
    return 0;
  } catch (e) {
    console.error(`verify-everr: ${url}: ${e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e)}`);
    return 1;
  }
}

function cmdUiGet(urlPath: string | undefined): Promise<number> {
  return printResponse(`${loadRun().ui}${urlPath || "/"}`);
}

function cmdUiCmd(command: string, json: string | undefined): Promise<number> {
  const r = loadRun();
  return printResponse(`${r.ui}/api/commands/${command}`, {
    method: "POST",
    headers: { Origin: r.ui, "X-Everr-Local": "1", "Content-Type": "application/json" },
    body: json || "{}",
  });
}

/** Render a local UI route in headless Chrome, wait until the text is visible, save screenshot/DOM/innerText. */
async function cmdUiShot(label: string, urlPath: string | undefined, waitFor: string | undefined): Promise<number> {
  const r = loadRun();
  const chrome = findChrome();
  const out = path.join(r.art, "ui", label);
  const rc = await shot({
    chrome,
    env: envWith(r.vars),
    scratchDir: r.dir,
    url: `${r.ui}${urlPath || "/"}`,
    outDir: out,
    waitFor: waitFor ?? "",
    timeoutMs: Number(process.env.UI_WAIT_MS || 20000),
  });
  console.log(`ui evidence: ${out}/{screenshot.png,dom.html,text.txt,result.json}`);
  return rc;
}

async function cmdCleanup(): Promise<number> {
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
  const envFile = path.join(dir, "env");
  if (existsSync(envFile)) {
    const vars = readEnvFile(envFile);
    const origins = [vars.EVERR_SQL_HTTP_ORIGIN, vars.EVERR_OTLP_HTTP_ORIGIN, vars.EVERR_LOCAL_UI_ORIGIN].filter(
      (o): o is string => Boolean(o),
    );
    const stopLog = path.join(art, "cleanup.stop.txt");
    runToFiles(BIN, ["local", "stop"], { stdout: stopLog }, { env: envWith(vars) });
    const deadline = Date.now() + 15000;
    for (const o of origins) {
      while (portPids(portOf(o)) && Date.now() < deadline) await sleep(300);
    }
    // Fallback: kill only the PIDs recorded at launch, and only if they still hold our ports.
    const recorded = readText(path.join(dir, "pids"));
    if (recorded !== undefined) {
      const pids = [...new Set(recorded.split("\n").flatMap((l) => l.split("=")[1]?.split(" ") ?? []).filter(Boolean))].sort();
      for (const pid of pids) {
        const holders = ` ${origins.map((o) => portPids(portOf(o))).join(" ")} `;
        if (holders.includes(` ${pid} `)) {
          teeAppend(stopLog, `force-killing recorded pid ${pid}`);
          try {
            process.kill(Number(pid));
          } catch {}
        }
      }
    }
    for (const o of origins) {
      if (portPids(portOf(o))) teeAppend(stopLog, `WARN ${o} still listening`);
    }
    const log = path.join(dir, "logs", "local.log");
    if (existsSync(log)) copyFileSync(log, path.join(art, "local.log"));
  }
  rmSync(toDelete, { recursive: true, force: true });
  // Only drop the current pointer if it names the run we just cleaned.
  if (readPointer(CURRENT) === runId) rmSync(CURRENT, { force: true });
  console.log(`cleaned up run ${runId}; evidence kept at ${art}`);
  listDir(art);
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case "build":
      return cmdBuild();
    case "launch":
      return cmdLaunch(args[0]);
    case "doctor":
      return cmdDoctor();
    case "env":
      return cmdEnv();
    case "cli": {
      const r = loadRun();
      return cmdCli(r, required(args[0], "label"), afterDashes(args.slice(1)));
    }
    case "cli-until": {
      const r = loadRun();
      return cmdCliUntil(r, required(args[0], "label"), required(args[1], "expected text"), afterDashes(args.slice(2)));
    }
    case "ui-get":
      return cmdUiGet(args[0]);
    case "ui-cmd":
      return cmdUiCmd(required(args[0], "command"), args[1]);
    case "ui-shot":
      return cmdUiShot(required(args[0], "label"), args[1], args[2]);
    case "cleanup":
      return cmdCleanup();
    default: {
      const web = cmd ? WEB_COMMANDS[cmd] : undefined;
      if (web) return web(args);
      console.log(`${USAGE}\n${WEB_USAGE}`);
      return 2;
    }
  }
}

process.exit(await main(process.argv.slice(2)));
