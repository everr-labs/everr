// Web app (packages/app) commands for verify-everr: compose ClickHouse+Postgres in a per-run
// project with its own ports and volumes, run `pnpm dev:web` against it, drive and record it.
import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { steps } from "./browser.ts";
import {
  REPO,
  SCRATCH_ROOT,
  SCRIPT_DIR,
  STATE_DIR,
  type RunId,
  basicAuth,
  defaultRunId,
  die,
  findChrome,
  freePort,
  hhmmss,
  http,
  isAlive,
  listDir,
  parseRunId,
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
  tail,
  teeAppend,
  writeEnvFile,
} from "./common.ts";

export const WEB_USAGE = `# Web app (packages/app) commands:
#
#   verify-everr web-launch [RUN_ID]     compose ClickHouse+Postgres (own project/ports/volumes) + pnpm dev:web
#   verify-everr web-doctor              read-only health of this web run
#   verify-everr web-env                 print the app env of this web run
#   verify-everr web-steps <label> <steps.json>   drive the browser (browser.ts steps), session kept per run
#   verify-everr web-http <label> <METHOD> <path> [curl args...]   HTTP against the app, recorded
#   verify-everr web-webhook <label> <event> <payload.json>  signed GitHub webhook (run's own secret)
#   verify-everr web-psql <label> "<SQL>"          read-only psql in this run's Postgres, recorded
#   verify-everr web-ch <label> "<SQL>"            ClickHouse SQL (default user) in this run, recorded
#   verify-everr web-cleanup             stop dev server + compose down -v (this project only), KEEP evidence`;

const WEB_STATE = path.join(STATE_DIR, "current-web");
const JOURNEYS = path.join(SCRIPT_DIR, "journeys");
const SECRET_LINE = /SECRET|MASTER_KEY|PRIVATE_KEY|PASSWORD|TOKEN/;

const webDir = (id: string) => path.join(SCRATCH_ROOT, `web-${id}`);
const webArt = (id: string) => path.join(STATE_DIR, "artifacts", `web-${id}`);

type WebRun = {
  id: RunId;
  dir: string;
  art: string;
  docker: string[];
  vars: Record<string, string>;
  project: string;
  origin: string;
  port: string;
  clickhouse: string;
};

/** `docker`, or `sudo -n docker` when the user is not in the docker group. */
function dockerCmd(): string[] | undefined {
  if (run("docker", ["info"]).status === 0) return ["docker"];
  if (run("sudo", ["-n", "docker", "info"]).status === 0) return ["sudo", "-n", "docker"];
  return undefined;
}

function requireDocker(): string[] {
  return dockerCmd() ?? die("docker is not usable (neither 'docker' nor 'sudo -n docker' can reach the daemon)");
}

function parseWebRun(id: RunId, docker: string[]): WebRun {
  const dir = webDir(id);
  const vars = readEnvFile(path.join(dir, "run.env"));
  const { WEB_PROJECT: project, WEB_ORIGIN: origin, WEB_PORT: port, CLICKHOUSE_URL: clickhouse } = vars;
  if (!project || !origin || !port || !clickhouse) die(`${dir}/run.env is missing the run's settings`);
  return { id, dir, art: webArt(id), docker, vars, project, origin, port, clickhouse };
}

function webLoad(): WebRun {
  const id = process.env.WEB_RUN_ID || readPointer(WEB_STATE);
  if (!id) die("no current web run; run 'verify-everr web-launch' first");
  const runId = parseRunId(id);
  if (!existsSync(path.join(webDir(runId), "run.env"))) {
    die(`web run ${runId} has no ${webDir(runId)}/run.env (already cleaned up?)`);
  }
  return parseWebRun(runId, requireDocker());
}

function composeArgs(w: WebRun, args: string[]): [string, string[]] {
  const [cmd, ...pre] = w.docker;
  return [
    cmd,
    [
      ...pre, "compose", "-p", w.project, "--env-file", path.join(w.dir, "compose.env"),
      "-f", path.join(REPO, "docker-compose.yaml"), "-f", path.join(SCRIPT_DIR, "compose.verify.yaml"), ...args,
    ],
  ];
}

const compose = (w: WebRun, args: string[]) => run(...composeArgs(w, args));

const composeToFile = (w: WebRun, args: string[], file: string, append = false) =>
  runToFiles(...composeArgs(w, args), { stdout: file, append });

const docker = (w: WebRun, args: string[]) => run(w.docker[0], [...w.docker.slice(1), ...args]);

/** ClickHouse SQL as the default user (`curl -fsS -u default:everr --data-binary`). */
async function chSql(clickhouse: string, sql: string): Promise<{ ok: boolean; text: string }> {
  const r = await http(`${clickhouse}/`, { method: "POST", body: sql, headers: { Authorization: basicAuth("default", "everr") } });
  return { ok: r.ok, text: r.ok ? r.text : `${r.error ?? `HTTP ${r.status}`}\n${r.text}` };
}

const rowPolicies = async (clickhouse: string) =>
  (await chSql(clickhouse, "SELECT count() FROM system.row_policies")).text.trim();

function expectedRowPolicies(): string {
  const dir = path.join(REPO, "clickhouse/init");
  let n = 0;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    n += readFileSync(path.join(dir, f), "utf8").split("\n").filter((l) => l.startsWith("CREATE ROW POLICY")).length;
  }
  return String(n);
}

const expectedMigrations = () =>
  String(readdirSync(path.join(REPO, "packages/app/drizzle"), { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".sql")).length);

const appliedMigrations = (w: WebRun) =>
  compose(w, ["exec", "-T", "postgres", "psql", "-U", "postgres", "-tAc", "select count(*) from drizzle.__drizzle_migrations"]).stdout.replace(/\s/g, "");

/** KEY=value lines as `set -a; source` reads them: later keys win, surrounding quotes stripped. */
function parseDotenv(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const m of text.matchAll(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/gm)) {
    let v = m[2];
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\(["\\$`])/g, "$1");
    else if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    vars[m[1]] = v;
  }
  return vars;
}

async function cmdWebLaunch([arg]: string[]): Promise<number> {
  const live = readPointer(WEB_STATE);
  if (live && existsSync(path.join(webDir(live), "run.env"))) {
    die(`web run ${live} is still live; run 'verify-everr web-cleanup' first`);
  }
  const dockerBin = requireDocker();
  if (Number(process.versions.node.split(".")[0]) < 23) {
    die(`need Node >= 23 on PATH (repo pins ${(readText(path.join(REPO, ".nvmrc")) ?? "").trim()})`);
  }
  if (!existsSync(path.join(REPO, "node_modules"))) runInherit("pnpm", ["install", "--frozen-lockfile"], { cwd: REPO });
  const id = parseRunId(arg || defaultRunId());
  const dir = webDir(id);
  const art = webArt(id);
  mkdirSync(dir, { recursive: true });
  mkdirSync(art, { recursive: true });
  const ch = await freePort();
  const pg = await freePort();
  const web = await freePort();
  const project = `verify-everr-${id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
  writeFileSync(path.join(dir, "compose.env"), `VERIFY_CH_PORT=${ch}\nVERIFY_PG_PORT=${pg}\n`);
  // App telemetry: into this checkout's live CLI verification run if there is one, else a dead port,
  // so it never lands in someone else's collector (the app defaults to 127.0.0.1:54318).
  let otlp = "http://127.0.0.1:9";
  const cliRun = readPointer(path.join(STATE_DIR, "current"));
  const cliEnv = cliRun ? path.join(SCRATCH_ROOT, cliRun, "env") : "";
  if (cliEnv && existsSync(cliEnv)) otlp = readEnvFile(cliEnv).EVERR_OTLP_HTTP_ORIGIN || otlp;
  // Base: the repo's own packages/app/.env.example (non-secret dev defaults and placeholders),
  // then per-run overrides. Secrets the app needs locally are generated per run, never reused.
  const example = (readText(path.join(REPO, "packages/app/.env.example")) ?? "")
    .split("\n")
    .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l));
  const secrets = [
    "BETTER_AUTH_SECRET", "CLICKHOUSE_SQL_API_MASTER_KEY", "GITHUB_APP_STATE_SECRET",
    "GITHUB_APP_WEBHOOK_SECRET", "POLAR_WEBHOOK_SECRET", "INGEST_VERIFY_SHARED_SECRET",
  ].map((s) => `${s}=${randomBytes(24).toString("hex")}`);
  const appEnv = [
    ...example,
    "DATABASE_HOST=127.0.0.1",
    `DATABASE_PORT=${pg}`,
    `CLICKHOUSE_URL=http://127.0.0.1:${ch}`,
    `BETTER_AUTH_URL=http://localhost:${web}`,
    ...secrets,
    "SMEE_CHANNEL=",
    "INGRESS_COLLECTOR_URL=http://127.0.0.1:9/webhook/github",
    `OTEL_EXPORTER_OTLP_ENDPOINT=${otlp}`,
    `VITE_EVERR_INGEST_ENDPOINT=${otlp}`,
    "EVERR_INGEST_KEY=",
  ];
  writeFileSync(path.join(dir, "app.env"), `${appEnv.join("\n")}\n`);
  writeEnvFile(path.join(dir, "run.env"), {
    WEB_RUN_ID: id,
    WEB_PROJECT: project,
    WEB_ORIGIN: `http://localhost:${web}`,
    WEB_PORT: String(web),
    CLICKHOUSE_URL: `http://127.0.0.1:${ch}`,
    PG_PORT: String(pg),
  });
  writeFileSync(WEB_STATE, `${id}\n`);
  const w = parseWebRun(id, dockerBin);
  writeFileSync(path.join(art, "app.env.redacted"), `${appEnv.filter((l) => !SECRET_LINE.test(l)).join("\n")}\n`);
  copyFileSync(path.join(dir, "run.env"), path.join(art, "run.env"));
  const runTxt = path.join(art, "run.txt");
  writeFileSync(
    runTxt,
    [
      `web_run_id: ${id}`,
      `compose_project: ${project}`,
      `git_head: ${run("git", ["-C", REPO, "rev-parse", "HEAD"]).stdout.trim()}`,
      `git_branch: ${run("git", ["-C", REPO, "rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim()}`,
      `docker: ${dockerBin.join(" ")} (${docker(w, ["version", "--format", "{{.Server.Version}}"]).stdout.trim()})`,
      `launched_at: ${stamp()}`,
      "",
    ].join("\n"),
  );
  console.log(`launching web run ${id} (project ${project}, ch :${ch}, pg :${pg}, web :${web})`);

  const t0 = Date.now();
  const secs = () => Math.floor((Date.now() - t0) / 1000);
  const buildLog = path.join(art, "compose-build.log");
  if (composeToFile(w, ["build", "clickhouse"], buildLog) !== 0) {
    tail(buildLog, 20);
    die("clickhouse image build failed");
  }
  const upLog = path.join(art, "compose-up.log");
  if (composeToFile(w, ["up", "-d", "--wait", "clickhouse", "postgres"], upLog) !== 0) {
    tail(upLog, 20);
    die("compose up failed; run 'verify-everr web-cleanup'");
  }
  // Healthy is not ready: wait until the last ClickHouse init script created every row policy.
  const wantRp = expectedRowPolicies();
  let deadline = Date.now() + 120000;
  while ((await rowPolicies(w.clickhouse)) !== wantRp) {
    if (Date.now() >= deadline) die(`ClickHouse init never created ${wantRp} row policies; see 'compose logs clickhouse'`);
    await sleep(1000);
  }
  console.log(`stack ready in ${secs()}s (ClickHouse ${wantRp} row policies, Postgres healthy)`);

  // Start the repo's own dev command in its own session/process group (detached = setsid), bound to loopback.
  const webLog = path.join(dir, "web.log");
  const logFd = openSync(webLog, "w");
  const server = spawn("pnpm", ["dev:web", "--port", String(web), "--strictPort", "--host", "127.0.0.1"], {
    cwd: REPO,
    env: { ...process.env, ...parseDotenv(appEnv.join("\n")) },
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);
  let serverExited = false;
  server.on("exit", () => {
    serverExited = true;
  });
  server.on("error", () => {
    serverExited = true;
  });
  const pgid = server.pid ?? die("could not start pnpm dev:web");
  writeFileSync(path.join(dir, "web.pgid"), `${pgid}\n`);
  // Ready = health answers, every drizzle migration applied (the server runs them on first load),
  // and both Graphile Worker runners connected.
  const wantMig = expectedMigrations();
  deadline = Date.now() + 240000;
  const ready = async () =>
    (await http(`${w.origin}/api/health`, { timeoutMs: 60000 })).text.includes('"ok":true') &&
    appliedMigrations(w) === wantMig &&
    (readText(webLog) ?? "").split("Worker connected and looking for jobs").length - 1 >= 2;
  while (!(await ready())) {
    if (serverExited || !isAlive(pgid)) {
      tail(webLog, 30);
      die("dev server exited; run 'verify-everr web-cleanup'");
    }
    if (Date.now() >= deadline) {
      tail(webLog, 30);
      die("web app not ready in 240s; run 'verify-everr web-cleanup'");
    }
    await sleep(2000);
  }
  server.unref();
  const pids = `web_port_pids=${portPids(web)}\n`;
  writeFileSync(path.join(dir, "pids"), pids);
  writeFileSync(path.join(art, "pids.txt"), pids);
  writeFileSync(runTxt, `launch_seconds: ${secs()}\n`, { flag: "a" });
  console.log(`WEB READY run=${id} url=${w.origin} migrations=${wantMig}/${wantMig} (${secs()}s)`);
  return 0;
}

async function cmdWebDoctor(): Promise<number> {
  const w = webLoad();
  let ok = true;
  const check = (label: string, pass: boolean) => {
    console.log(`${pass ? "ok  " : "FAIL"} ${label}`);
    if (!pass) ok = false;
  };
  console.log(`web run: ${w.id}  project: ${w.project}  head: ${run("git", ["-C", REPO, "rev-parse", "--short", "HEAD"]).stdout.trim()}`);
  const ps = compose(w, ["ps", "--format", "{{.Service}} {{.Health}}"]).stdout.split("\n");
  for (const svc of ["clickhouse", "postgres"]) {
    check(`${svc} container of project ${w.project} is healthy`, ps.includes(`${svc} healthy`));
  }
  const appRo = await http(`${w.clickhouse}/?query=SELECT%201`, { headers: { Authorization: basicAuth("app_ro", "app-dev") } });
  check(`ClickHouse on :${w.clickhouse.slice(w.clickhouse.lastIndexOf(":") + 1)} answers as app_ro (app-dev)`, appRo.ok);
  const wantRp = expectedRowPolicies();
  check(`ClickHouse row policies = ${wantRp}`, (await rowPolicies(w.clickhouse)) === wantRp);
  const wantMig = expectedMigrations();
  check(`Postgres drizzle migrations applied = ${wantMig}`, appliedMigrations(w) === wantMig);
  const pgid = Number(readPointer(path.join(w.dir, "web.pgid")));
  check(`dev server process group ${pgid} alive`, pgid > 0 && isAlive(pgid));
  const want = (readText(path.join(w.dir, "pids")) ?? "").split("=")[1]?.trim() ?? "";
  const now = portPids(w.port);
  check(`web port ${w.port} owned by launch pids [${want}]`, want !== "" && want === now);
  const health = await http(`${w.origin}/api/health`);
  check('GET /api/health is {"ok":true}', health.ok && health.text.includes('"ok":true'));
  const signIn = await http(`${w.origin}/auth/sign-in`);
  check("GET /auth/sign-in serves the app shell", signIn.ok && signIn.text.includes("<html"));
  const others = docker(w, ["ps", "--format", "{{.Names}}"]).stdout.split("\n").filter((n) => n && !n.startsWith(`${w.project}-`));
  if (others.length) console.log(`info other containers exist on this host (not ours, never touched): ${others.join(" ")} `);
  if (ok) {
    console.log("WEB DOCTOR OK");
    return 0;
  }
  console.log("WEB DOCTOR FAILED");
  return 1;
}

function cmdWebEnv(): number {
  const w = webLoad();
  process.stdout.write(readText(path.join(w.dir, "run.env")) ?? "");
  const app = (readText(path.join(w.dir, "app.env")) ?? "").split("\n").filter((l) => l && !SECRET_LINE.test(l));
  console.log(app.join("\n"));
  return 0;
}

/** A fresh evidence dir; an earlier attempt's evidence is kept next to it, never overwritten. */
function freshDir(out: string): string {
  if (existsSync(out)) renameSync(out, `${out}.prev-${hhmmss()}`);
  mkdirSync(out, { recursive: true });
  return out;
}

/** A file given as a path, or by name from scripts/journeys/. */
const journeyFile = (file: string) => (existsSync(file) ? file : path.join(JOURNEYS, file));

async function cmdWebSteps([label, file]: string[]): Promise<number> {
  const w = webLoad();
  const name = required(label, "label");
  const stepsFile = journeyFile(required(file, "steps.json"));
  if (!existsSync(stepsFile)) die(`no steps file ${file} (looked in . and ${JOURNEYS})`);
  const chrome = findChrome();
  const out = freshDir(path.join(w.art, "web", name));
  const rc = await steps({
    chrome,
    env: { ...process.env, ...w.vars },
    scratchDir: w.dir,
    profileDir: path.join(w.dir, "chrome-profile"),
    baseUrl: w.origin,
    outDir: out,
    stepsFile,
  });
  console.log(`web evidence: ${out} (${readdirSync(out).sort().join(" ")} )`);
  return rc;
}

function webHttp(w: WebRun, label: string, method: string, urlPath: string, curlArgs: string[]): number {
  const out = freshDir(path.join(w.art, "http", label));
  writeFileSync(path.join(out, "command.txt"), `${shellQuote(["curl", "-sS", "-X", method, ...curlArgs, `${w.origin}${urlPath}`])}\n`);
  const r = run("curl", ["-sS", "-X", method, "-o", path.join(out, "body"), "-D", path.join(out, "headers"), "-w", "%{http_code}", ...curlArgs, `${w.origin}${urlPath}`]);
  process.stderr.write(r.stderr);
  writeFileSync(path.join(out, "status"), r.stdout);
  const body = existsSync(path.join(out, "body")) ? readFileSync(path.join(out, "body")).subarray(0, 400) : Buffer.alloc(0);
  console.log(`${method} ${urlPath} -> ${r.stdout}`);
  process.stdout.write(body);
  console.log();
  return 0;
}

function cmdWebHttp([label, method, urlPath, ...curlArgs]: string[]): number {
  const w = webLoad();
  return webHttp(w, required(label, "label"), required(method, "method"), required(urlPath, "path"), curlArgs);
}

/** POST a GitHub webhook to /webhook/github signed with THIS run's GITHUB_APP_WEBHOOK_SECRET
 * (generated at web-launch), exactly as GitHub signs deliveries for a configured App. */
function cmdWebWebhook([label, event, payloadArg]: string[]): number {
  const w = webLoad();
  const name = required(label, "label");
  const ev = required(event, "event");
  const payload = journeyFile(required(payloadArg, "payload file"));
  const secret = parseDotenv(readText(path.join(w.dir, "app.env")) ?? "").GITHUB_APP_WEBHOOK_SECRET ?? "";
  const sig = `sha256=${createHmac("sha256", secret).update(readFileSync(payload)).digest("hex")}`;
  const delivery = `verify-${Math.floor(Date.now() / 1000)}-${process.pid}`;
  writeFileSync(path.join(w.dir, "last-delivery"), `${delivery}\n`);
  webHttp(w, name, "POST", "/webhook/github", [
    "-H", "content-type: application/json", "-H", `x-github-event: ${ev}`, "-H", `x-github-delivery: ${delivery}`,
    "-H", `x-hub-signature-256: ${sig}`, "--data-binary", `@${payload}`,
  ]);
  const line = `delivery: ${delivery}`;
  console.log(line);
  writeFileSync(path.join(w.art, "http", name, "delivery.txt"), `${line}\n`);
  return 0;
}

function dbEvidence(w: WebRun, label: string, sql: string): string {
  const out = path.join(w.art, "db", label);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "query.sql"), `${sql}\n`);
  return out;
}

function printDbResult(out: string, rc: number): number {
  writeFileSync(path.join(out, "exit_code"), `${rc}\n`);
  process.stdout.write((readText(path.join(out, "stdout")) ?? "") + (readText(path.join(out, "stderr")) ?? ""));
  return rc;
}

function cmdWebPsql([label, sql]: string[]): number {
  const w = webLoad();
  const query = required(sql, "sql");
  const out = dbEvidence(w, required(label, "label"), query);
  const [cmd, args] = composeArgs(w, [
    "exec", "-T", "postgres", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1",
    "-c", "SET default_transaction_read_only = on", "-c", query,
  ]);
  return printDbResult(out, runToFiles(cmd, args, { stdout: path.join(out, "stdout"), stderr: path.join(out, "stderr") }));
}

async function cmdWebCh([label, sql]: string[]): Promise<number> {
  const w = webLoad();
  const query = required(sql, "sql");
  const out = dbEvidence(w, required(label, "label"), query);
  const r = await chSql(w.clickhouse, `${query} FORMAT JSONEachRow`);
  writeFileSync(path.join(out, "stdout"), r.ok ? r.text : "");
  writeFileSync(path.join(out, "stderr"), r.ok ? "" : r.text);
  return printDbResult(out, r.ok ? 0 : 1);
}

async function cmdWebCleanup(): Promise<number> {
  const id = process.env.WEB_RUN_ID || readPointer(WEB_STATE);
  if (!id) {
    console.log("no web run to clean up");
    return 0;
  }
  const runId = parseRunId(id);
  const dir = webDir(runId);
  const art = webArt(runId);
  const toDelete = scratchDirToDelete(dir);
  mkdirSync(art, { recursive: true });
  const cleanupLog = path.join(art, "cleanup.txt");
  if (existsSync(path.join(dir, "run.env"))) {
    const w = parseWebRun(runId, dockerCmd() ?? ["docker"]);
    // Dev server: signal the process group we started (session leader), never by name.
    const pgid = Number(readPointer(path.join(dir, "web.pgid")));
    if (pgid > 0) {
      const signal = (sig: NodeJS.Signals) => {
        try {
          process.kill(-pgid, sig);
        } catch {}
      };
      signal("SIGTERM");
      const deadline = Date.now() + 15000;
      while (portPids(w.port) && Date.now() < deadline) await sleep(500);
      signal("SIGKILL");
      if (portPids(w.port)) teeAppend(cleanupLog, `WARN web port ${w.port} still listening`);
    }
    const webLog = path.join(dir, "web.log");
    if (existsSync(webLog)) copyFileSync(webLog, path.join(art, "web.log"));
    composeToFile(w, ["logs", "--no-color"], path.join(art, "compose.log"));
    // Only this run's compose project, with its named volumes. Other projects are untouched.
    if (composeToFile(w, ["down", "-v", "--remove-orphans"], cleanupLog, true) !== 0) {
      teeAppend(cleanupLog, "WARN compose down failed");
    }
    const leftovers = docker(w, ["ps", "-a", "--filter", `label=com.docker.compose.project=${w.project}`, "--format", "{{.Names}}"]);
    for (const name of leftovers.stdout.split("\n").filter(Boolean)) teeAppend(cleanupLog, `WARN leftover container: ${name}`);
  }
  rmSync(toDelete, { recursive: true, force: true });
  if (readPointer(WEB_STATE) === runId) rmSync(WEB_STATE, { force: true });
  console.log(`cleaned up web run ${runId}; evidence kept at ${art}`);
  listDir(art);
  return 0;
}

export const WEB_COMMANDS: Record<string, (args: string[]) => number | Promise<number>> = {
  "web-launch": cmdWebLaunch,
  "web-doctor": cmdWebDoctor,
  "web-env": cmdWebEnv,
  "web-steps": cmdWebSteps,
  "web-http": cmdWebHttp,
  "web-webhook": cmdWebWebhook,
  "web-psql": cmdWebPsql,
  "web-ch": cmdWebCh,
  "web-cleanup": cmdWebCleanup,
};
