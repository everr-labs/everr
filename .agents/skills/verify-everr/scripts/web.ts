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
import {
  AGENT_BROWSER_HINT,
  REPO,
  SCRATCH_ROOT,
  SCRIPT_DIR,
  STATE_DIR,
  type RunId,
  agentBrowserVersion,
  basicAuth,
  browserSession,
  closeBrowser,
  defaultRunId,
  die,
  freePort,
  hhmmss,
  http,
  isAlive,
  listDir,
  parseRunId,
  portOf,
  portPids,
  printBrowserEnv,
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
#   verify-everr web-launch [RUN_ID]     compose ClickHouse+Postgres+OTLP collector (own project/ports/volumes) + pnpm dev:web
#   verify-everr web-doctor              read-only health of this web run
#   verify-everr web-env                 print the app env of this web run
#   verify-everr web-browser-env         export lines for agent-browser: AGENT_BROWSER_SESSION, WEB, SHOTS
#   verify-everr web-http <label> <METHOD> <path> [curl args...]   HTTP against the app, recorded
#   verify-everr web-webhook <label> <event> <payload.json>  signed GitHub webhook (run's own secret)
#   verify-everr web-psql <label> "<SQL>"          read-only psql in this run's Postgres, recorded
#   verify-everr web-ch <label> "<SQL>"            ClickHouse SQL (default user) in this run, recorded
#   verify-everr web-seed [key-file]     send fixed logs/spans/error over OTLP with the run's ek_ key (default:
#                                        the key shown in web/api-keys-03-issued.txt), wait until they land
#   verify-everr web-cleanup             stop dev server + compose down -v (this project only), KEEP evidence`;

const WEB_STATE = path.join(STATE_DIR, "current-web");
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
  otlp: string;
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
  const { WEB_PROJECT: project, WEB_ORIGIN: origin, WEB_PORT: port, CLICKHOUSE_URL: clickhouse, OTLP_HTTP_ORIGIN: otlp } = vars;
  if (!project || !origin || !port || !clickhouse || !otlp) die(`${dir}/run.env is missing the run's settings`);
  return { id, dir, art: webArt(id), docker, vars, project, origin, port, clickhouse, otlp };
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

/** HTTP status of an empty OTLP/HTTP logs export without Authorization (401 = receiver up, auth on). */
const otlpUnauthStatus = async (w: WebRun) =>
  (await http(`${w.otlp}/v1/logs`, { method: "POST", body: "{}", headers: { "content-type": "application/json" }, timeoutMs: 5000 })).status;

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
  const otlpHttp = await freePort();
  const otlpGrpc = await freePort();
  const project = `verify-everr-${id.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
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
  const secretValues = Object.fromEntries(
    [
      "BETTER_AUTH_SECRET", "CLICKHOUSE_SQL_API_MASTER_KEY", "GITHUB_APP_STATE_SECRET",
      "GITHUB_APP_WEBHOOK_SECRET", "POLAR_WEBHOOK_SECRET", "INGEST_VERIFY_SHARED_SECRET",
    ].map((s) => [s, randomBytes(24).toString("hex")]),
  );
  const secrets = Object.entries(secretValues).map(([k, v]) => `${k}=${v}`);
  // Compose interpolation for compose.verify.yaml. The collector shares the app's per-run
  // INGEST_VERIFY_SHARED_SECRET, which guards /api/internal/verify-key.
  writeFileSync(
    path.join(dir, "compose.env"),
    [
      `VERIFY_CH_PORT=${ch}`, `VERIFY_PG_PORT=${pg}`, `VERIFY_WEB_PORT=${web}`,
      `VERIFY_OTLP_HTTP_PORT=${otlpHttp}`, `VERIFY_OTLP_GRPC_PORT=${otlpGrpc}`,
      `VERIFY_COLLECTOR_CONFIG=${path.join(SCRIPT_DIR, "collector-config.verify.yaml")}`,
      `INGEST_VERIFY_SHARED_SECRET=${secretValues.INGEST_VERIFY_SHARED_SECRET}`, "",
    ].join("\n"),
  );
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
    OTLP_HTTP_ORIGIN: `http://127.0.0.1:${otlpHttp}`,
    OTLP_GRPC_PORT: String(otlpGrpc),
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
  console.log(`launching web run ${id} (project ${project}, ch :${ch}, pg :${pg}, web :${web}, otlp http :${otlpHttp} grpc :${otlpGrpc})`);

  const t0 = Date.now();
  const secs = () => Math.floor((Date.now() - t0) / 1000);
  const buildLog = path.join(art, "compose-build.log");
  // Both images are tagged once (everr-verify-*:local) and reused from cache by later runs.
  if (composeToFile(w, ["build", "clickhouse", "collector"], buildLog) !== 0) {
    tail(buildLog, 20);
    die("clickhouse/collector image build failed");
  }
  const upLog = path.join(art, "compose-up.log");
  if (composeToFile(w, ["up", "-d", "--wait", "clickhouse", "postgres", "collector"], upLog) !== 0) {
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
  // The collector has no healthcheck: ready = its OTLP/HTTP receiver answers and rejects a request without a key.
  deadline = Date.now() + 60000;
  while ((await otlpUnauthStatus(w)) !== 401) {
    if (Date.now() >= deadline) die("collector OTLP receiver never answered 401 without a key; see 'compose logs collector'");
    await sleep(1000);
  }
  console.log(`stack ready in ${secs()}s (ClickHouse ${wantRp} row policies, Postgres healthy, collector OTLP on :${otlpHttp})`);

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
  check(`collector container of project ${w.project} is running`, compose(w, ["ps", "--format", "{{.Service}} {{.State}}"]).stdout.split("\n").includes("collector running"));
  check(`collector OTLP/HTTP on :${portOf(w.otlp)} rejects a request without a key (401)`, (await otlpUnauthStatus(w)) === 401);
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
  const ab = agentBrowserVersion();
  check(ab ? `agent-browser on PATH (${ab})` : `agent-browser on PATH (missing; ${AGENT_BROWSER_HINT})`, Boolean(ab));
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

function cmdWebBrowserEnv(): number {
  const w = webLoad();
  const vars = {
    AGENT_BROWSER_SESSION: browserSession(`web-${w.id}`),
    // The dev server compiles a route on its first visit, which can outlast agent-browser's 25s default.
    AGENT_BROWSER_DEFAULT_TIMEOUT: "90000",
    WEB: w.origin,
  };
  return printBrowserEnv(vars, path.join(w.art, "web"));
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
  const file = required(payloadArg, "payload file");
  const payload = existsSync(file) ? file : path.join(SCRIPT_DIR, file);
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

// Seed data for web-seed. Every value the explore-seeded recipe asserts on is fixed here
// (features/web-explore.md): change both together.
export const SEED = {
  service: "verify-seed-api",
  logs: ["verify-seed: checkout started", "verify-seed: payment provider slow", "verify-seed: charge failed"],
  exceptionType: "VerifySeedPaymentError",
  exceptionMessage: "card declined by verify-seed provider",
  rootSpan: "POST /checkout",
  spans: 3,
  // Sent as a resource attribute; the public pipeline must replace it with the key's org.
  spoofTenant: "spoofed-by-client",
};

function seedPayloads(): { traceId: string; traces: unknown; logs: unknown } {
  const hex = (n: number) => randomBytes(n).toString("hex");
  const now = BigInt(Date.now()) * 1000000n;
  const ago = (ms: number) => String(now - BigInt(ms) * 1000000n);
  const str = (key: string, value: string) => ({ key, value: { stringValue: value } });
  const resource = {
    attributes: [str("service.name", SEED.service), str("deployment.environment", "verify"), str("everr.tenant.id", SEED.spoofTenant)],
  };
  const scope = { name: "verify-everr-seed" };
  const traceId = hex(16);
  const [root, db, charge] = [hex(8), hex(8), hex(8)];
  const span = (spanId: string, parentSpanId: string, name: string, startAgo: number, endAgo: number, error: boolean) => ({
    traceId, spanId, parentSpanId, name, kind: parentSpanId ? 3 : 2,
    startTimeUnixNano: ago(startAgo), endTimeUnixNano: ago(endAgo),
    attributes: [str("verify.seed", "1")],
    status: error ? { code: 2, message: SEED.exceptionMessage } : { code: 1 },
  });
  const spans = [
    span(root, "", SEED.rootSpan, 1000, 0, true),
    span(db, root, "SELECT orders", 950, 800, false),
    span(charge, root, "charge card", 780, 50, true),
  ];
  const [started, slow, failed] = SEED.logs;
  const log = (msAgo: number, severityNumber: number, severityText: string, body: string, spanId: string, attributes: unknown[] = []) => ({
    timeUnixNano: ago(msAgo), observedTimeUnixNano: ago(0), severityNumber, severityText,
    body: { stringValue: body }, attributes, traceId, spanId,
  });
  const records = [
    log(900, 9, "INFO", started, root),
    log(600, 13, "WARN", slow, root),
    // Errors = logs with severity >= 17 and exception.* attributes (telemetry-explorer errors/sql/fingerprint.ts).
    log(300, 17, "ERROR", failed, charge, [
      str("exception.type", SEED.exceptionType),
      str("exception.message", SEED.exceptionMessage),
      str("exception.stacktrace", `${SEED.exceptionType}: ${SEED.exceptionMessage}\n    at charge (checkout.ts:42)`),
    ]),
  ];
  return {
    traceId,
    traces: { resourceSpans: [{ resource, scopeSpans: [{ scope, spans }] }] },
    logs: { resourceLogs: [{ resource, scopeLogs: [{ scope, logRecords: records }] }] },
  };
}

/** Seed Explore through the real public ingest path: OTLP/HTTP into this run's collector with an
 * `ek_` key created in the UI, verified by the app, tenant-stamped, written via the otel.* views. */
async function cmdWebSeed([keyArg]: string[]): Promise<number> {
  const w = webLoad();
  const out = path.join(w.art, "seed");
  if (existsSync(path.join(out, "seed.txt"))) die(`this run is already seeded (${out}); the recipe's counts assume one seed per run`);
  const keyFile = keyArg || path.join(w.art, "web", "api-keys-03-issued.txt");
  const key = (readText(keyFile) ?? "").match(/\bek_[A-Za-z0-9_-]{20,}/)?.[0];
  if (!key) die(`no ek_ key in ${keyFile}; run the web-api-keys.md "Create, list, reload" recipe first`);
  mkdirSync(out, { recursive: true });
  const summary = path.join(out, "seed.txt");
  const { traceId, traces, logs } = seedPayloads();
  let ok = true;
  const send = async (signal: string, body: unknown, auth: string) => {
    const r = await http(`${w.otlp}/v1/${signal}`, {
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", authorization: auth },
    });
    return `${r.status} ${r.text.trim() || r.error || ""}`.trim();
  };
  for (const [signal, body] of [["traces", traces], ["logs", logs]] as const) {
    writeFileSync(path.join(out, `${signal}.json`), `${JSON.stringify(body, null, 2)}\n`);
    const res = await send(signal, body, `Bearer ${key}`);
    teeAppend(summary, `POST ${w.otlp}/v1/${signal} (run key ${key.slice(0, 7)}...) -> ${res}`);
    if (!res.startsWith("200")) ok = false;
  }
  const bad = await send("logs", logs, "Bearer ek_verify_invalid_key_000000000000");
  teeAppend(summary, `POST ${w.otlp}/v1/logs (invalid key) -> ${bad}`);
  if (!bad.startsWith("401")) ok = false;
  if (!ok) die(`ingest did not answer as expected; see ${summary} and 'compose logs collector'`);

  // Ingest is asynchronous (exporter queue + materialized views): wait for every row.
  const sql = `SELECT 'logs' AS signal, tenant_id, count() AS n, countIf(SeverityNumber >= 17) AS errors FROM app.logs WHERE ServiceName = '${SEED.service}' GROUP BY tenant_id
    UNION ALL SELECT 'traces', tenant_id, count(), countIf(StatusCode = 'Error') FROM app.traces WHERE ServiceName = '${SEED.service}' GROUP BY tenant_id FORMAT JSONEachRow`;
  type Row = { signal: string; tenant_id: string; n: string; errors: string };
  let rows: Row[] = [];
  const deadline = Date.now() + 60000;
  const t0 = Date.now();
  for (;;) {
    const r = await chSql(w.clickhouse, sql);
    rows = r.ok ? r.text.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Row) : [];
    const count = (s: string) => rows.filter((x) => x.signal === s).reduce((a, x) => a + Number(x.n), 0);
    if (count("logs") >= SEED.logs.length && count("traces") >= SEED.spans) break;
    if (Date.now() >= deadline) {
      writeFileSync(path.join(out, "rows.json"), `${JSON.stringify(rows, null, 2)}\n`);
      die(`seeded rows not in ClickHouse after 60s (got ${JSON.stringify(rows)}); see 'compose logs collector'`);
    }
    await sleep(1000);
  }
  writeFileSync(path.join(out, "rows.json"), `${JSON.stringify(rows, null, 2)}\n`);
  // The key's organization (better-auth apikey.reference_id) is the tenant every row must carry.
  const [cmd, args] = composeArgs(w, [
    "exec", "-T", "postgres", "psql", "-U", "postgres", "-tA", "-c",
    // better-auth stores the key hashed plus its first characters in `start`; the key matched
    // /ek_[A-Za-z0-9_-]+/ above, so it is safe to inline.
    `select reference_id from apikey where start <> '' and strpos('${key}', start) = 1 order by created_at desc limit 1`,
  ]);
  const org = run(cmd, args).stdout.trim();
  const tenants = [...new Set(rows.map((r) => r.tenant_id))];
  const tenantOk = tenants.length === 1 && tenants[0] === org && org !== SEED.spoofTenant;
  teeAppend(summary, `rows after ${Math.round((Date.now() - t0) / 1000)}s: ${rows.map((r) => `${r.signal}=${r.n} (${r.signal === "logs" ? "severity >= 17" : "status Error"}: ${r.errors})`).join(", ")}`);
  teeAppend(summary, `tenant_id ${tenants.join(",")} ${tenantOk ? "==" : "!="} key organization ${org} (client sent everr.tenant.id=${SEED.spoofTenant})`);
  if (!tenantOk) die("seeded rows are not scoped to the key's organization");
  const line = `SEEDED run=${w.id} service=${SEED.service} logs=${SEED.logs.length} errors=1 spans=${SEED.spans} traces=1 trace=${traceId} tenant=${org}`;
  writeFileSync(path.join(out, "trace_id"), `${traceId}\n`);
  teeAppend(summary, line);
  return 0;
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
    await closeBrowser(browserSession(`web-${runId}`), cleanupLog);
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
  "web-browser-env": cmdWebBrowserEnv,
  "web-http": cmdWebHttp,
  "web-webhook": cmdWebWebhook,
  "web-psql": cmdWebPsql,
  "web-ch": cmdWebCh,
  "web-seed": cmdWebSeed,
  "web-cleanup": cmdWebCleanup,
};
