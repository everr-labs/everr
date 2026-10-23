// Web verification drives the same pnpm dev graph as development, with isolated data and service names.
import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac, randomBytes } from "node:crypto";
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
import os from "node:os";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
import { createRequire } from "node:module";
import { connect } from "node:http2";
import {
  REPO,
  SCRATCH_ROOT,
  SCRIPT_DIR,
  STATE_DIR,
  type Proc,
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
  isRecord,
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
  which,
} from "./common.ts";

export const WEB_USAGE = `# Web verification through pnpm dev (both products, Cloud selected by default):
#
#   verify-everr web-launch [RUN_ID] [--app app|cloud] [--ignore-memory]
#                                        isolated pnpm dev graph, data, service names, and supervisor socket
#   verify-everr web-doctor              read-only health of this web run
#   verify-everr web-env                 print this run's non-secret connection metadata
#   verify-everr web-browser-env         export lines for agent-browser: AGENT_BROWSER_SESSION, WEB, SHOTS,
#                                        SDK_PAGE_ORIGIN, and SDK_URL once web-sdk-page ran
#   verify-everr web-http <label> <METHOD> <path> [curl args...]   HTTP against the app, recorded
#   verify-everr web-webhook <label> <event> <payload.json>  signed GitHub webhook (run's own secret)
#   verify-everr web-psql <label> "<SQL>"          read-only psql in this run's Postgres, recorded
#   verify-everr web-ch <label> "<SQL>"            ClickHouse SQL (default user) in this run, recorded
#   verify-everr web-key-save <name>     read text containing a full ek_ key on stdin, keep it in the run's scratch dir
#   verify-everr web-key <name>          print a saved full key (never the truncated ek_xxx... list prefix)
#   verify-everr web-onboard             finish the Home onboarding in the run's browser (banner-safe), recorded
#   verify-everr web-apply <body.json> [--key-name N] [--dry-run]   POST /api/apply with a Manage-as-code key, recorded
#   verify-everr web-net <label> <seconds> [--reload]   clear the browser's network log, (reload,) wait, save
#                                        it, count /_serverFn/ calls per function and new page errors
#   verify-everr web-report [RUN_ID]     write <evidence>/report.md: every video and screenshot with its caption
#   verify-everr web-seed [--key-name N | --key-file F]   send fixed logs/spans/error over OTLP with a saved
#                                        key (default name: secret), wait until they land
#   verify-everr web-collector-restart   restart the selected native collector through Process Compose
#   verify-everr web-record --steps F [record.ts args]   record a scripted journey as mp4 + key frames into
#                                        <evidence>/video/ (base URL and the run browser's session filled in)
#   verify-everr web-sdk-page [--local]  bundle packages/otel-web/src into a test page, serve it on SDK_PAGE_ORIGIN
#                                        with the saved 'public' key (or the CLI run's collector, no key, with --local)
#   verify-everr web-cleanup             stop dev server + compose down -v (this project only), KEEP evidence`;

const WEB_STATE = path.join(STATE_DIR, "current-web");

const webDir = (id: string) => path.join(SCRATCH_ROOT, `web-${id}`);
const webArt = (id: string) => path.join(STATE_DIR, "artifacts", `web-${id}`);

type WebRun = {
  id: RunId;
  dir: string;
  art: string;
  docker: string[];
  vars: Record<string, string>;
  project: string;
  product: "app" | "cloud";
  origin: string;
  port: string;
  clickhouse: string;
  otlp: string;
};

/** Use the same Docker access as pnpm dev. */
function dockerCmd(): string[] | undefined {
  if (run("docker", ["info"]).status === 0) return ["docker"];
  return undefined;
}

function requireDocker(): string[] {
  return dockerCmd() ?? die("docker cannot reach the daemon; pnpm dev requires direct Docker access");
}

function parseWebRun(id: RunId, docker: string[]): WebRun {
  const dir = webDir(id);
  const vars = readEnvFile(path.join(dir, "run.env"));
  const { WEB_PROJECT: project, WEB_ORIGIN: origin, WEB_PORT: port, CLICKHOUSE_URL: clickhouse, OTLP_HTTP_ORIGIN: otlp } = vars;
  if (!project || !origin || !port || !clickhouse || !otlp) die(`${dir}/run.env is missing the run's settings`);
  if (vars.PORTLESS_CA) {
    setDefaultCACertificates([...getCACertificates("default"), readFileSync(vars.PORTLESS_CA, "utf8")]);
  }
  const product = vars.WEB_APP === "app" ? "app" : "cloud";
  return { id, dir, art: webArt(id), docker, vars, project, product, origin, port, clickhouse, otlp };
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
  return [cmd, [...pre, "compose", "-p", w.project, "--profile", "mail", "-f", path.join(REPO, "scripts/dev/compose.yaml"), ...args]];
}
const composeEnv = () => ({ ...process.env, DEV_ROOT: REPO });
const compose = (w: WebRun, args: string[]) => run(...composeArgs(w, args), { env: composeEnv() });
const composeToFile = (w: WebRun, args: string[], file: string, append = false) =>
  runToFiles(...composeArgs(w, args), { stdout: file, append }, { env: composeEnv() });
const docker = (w: WebRun, args: string[]) => run(w.docker[0], [...w.docker.slice(1), ...args]);
const pcBin = () => which("process-compose") ?? path.join(REPO, ".dev/bin/process-compose");
const pc = (w: WebRun, args: string[]) => run(pcBin(), ["-U", "-u", path.join(w.dir, "state", "pc.sock"), ...args]);
function processReady(w: WebRun, name: string): boolean {
  const result = pc(w, ["process", "get", name, "-o", "json"]);
  try {
    const parsed = JSON.parse(result.stdout);
    const state = Array.isArray(parsed) ? parsed.find((item) => item.name === name) : parsed;
    return result.status === 0 && state.is_ready === "Ready" && state.is_running === true;
  } catch { return false; }
}
const collectorConfig = (product: string) => path.join(REPO, "scripts/dev", `collector-${product}.yaml`);
function snapshotCollectors(w: WebRun, products: string[] = ["app", "cloud"]): void {
  for (const product of products) copyFileSync(collectorConfig(product), path.join(w.art, `collector-${product}.yaml`));
}
function corsConfig(w: WebRun): { corsOrigins: string[]; corsHeaders: string[] } {
  const yaml = createRequire(path.join(REPO, "packages/app/package.json"))("yaml");
  const config = yaml.parse(readFileSync(collectorConfig(w.product), "utf8"));
  const cors = config.receivers["otlp/public"].protocols.http.cors;
  return { corsOrigins: cors.allowed_origins, corsHeaders: cors.allowed_headers };
}
async function corsPreflight(w: WebRun): Promise<{ status: number; allowOrigin: string }> {
  const cors = corsConfig(w);
  try {
    const res = await fetch(`${w.otlp}/v1/logs`, {
      method: "OPTIONS",
      headers: {
        Origin: cors.corsOrigins.find((o) => o !== "*") ?? "http://127.0.0.1:1",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": cors.corsHeaders.map((h) => h.toLowerCase()).sort().join(","),
      },
      signal: AbortSignal.timeout(5000),
    });
    return { status: res.status, allowOrigin: res.headers.get("access-control-allow-origin") ?? "" };
  } catch { return { status: 0, allowOrigin: "" }; }
}

async function waitCollector(w: WebRun): Promise<void> {
  // The collector has no healthcheck: ready = its OTLP/HTTP receiver answers and rejects a request without a key.
  const deadline = Date.now() + 60000;
  while (!processReady(w, `collector-${w.product}`) || (await otlpUnauthStatus(w)) !== 401) {
    if (Date.now() >= deadline) die("collector did not reach readiness; see this run's web.log");
    await sleep(1000);
  }
}

async function grpcUnauthStatus(w: WebRun): Promise<number> {
  return new Promise((resolve) => {
    const client = connect(w.vars.OTLP_GRPC_ORIGIN);
    let status = 0;
    const done = (value: number) => { client.destroy(); resolve(value); };
    client.on("error", () => done(0));
    const req = client.request({ ":method": "POST", ":path": "/opentelemetry.proto.collector.logs.v1.LogsService/Export", "content-type": "application/grpc", te: "trailers" });
    const onHeaders = (headers: Record<string, unknown>) => { if (headers["grpc-status"] !== undefined) status = Number(headers["grpc-status"]); };
    req.on("response", onHeaders);
    req.on("trailers", onHeaders);
    req.on("error", () => done(0));
    req.on("end", () => done(status));
    req.setTimeout(5000, () => done(0));
    req.resume();
    req.end(Buffer.alloc(5));
  });
}

const keyFile = (w: WebRun, name: string) => {
  if (!/^[a-z0-9-]+$/.test(name)) die(`key name must match [a-z0-9-]+: ${name}`);
  return path.join(w.dir, "keys", name);
};

/** ClickHouse SQL as the default user (`curl -fsS -u default:dev --data-binary`). */
async function chSql(clickhouse: string, sql: string): Promise<{ ok: boolean; text: string }> {
  const r = await http(`${clickhouse}/`, { method: "POST", body: sql, headers: { Authorization: basicAuth("default", "dev") } });
  return { ok: r.ok, text: r.ok ? r.text : `${r.error ?? `HTTP ${r.status}`}\n${r.text}` };
}

const rowPolicies = async (clickhouse: string) =>
  // Per-organization policies (sql_api_org_*) appear when the app provisions an org; count the init ones.
  (await chSql(clickhouse, "SELECT count() FROM system.row_policies WHERE short_name NOT LIKE 'sql_api_org_%'")).text.trim();

function expectedRowPolicies(product: string): string {
  if (product === "app") return "0";
  const dir = path.join(REPO, "clickhouse/init/cloud");
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
  compose(w, ["exec", "-T", "postgres", "psql", "-U", "postgres", "-d", `everr_${w.product}`, "-tAc", "select count(*) from drizzle.__drizzle_migrations"]).stdout.replace(/\s/g, "");

const SCHEMA_ERROR_RE = /\bschema detection failed\b/;

// Reserve headroom for two Vite servers, two native collectors, and three database containers.
const WEB_RUN_MIB = 6144;
function meminfo(): { availMiB: number; totalMiB: number; swapMiB: number } {
  const text = readText("/proc/meminfo");
  if (!text) {
    let available = os.freemem();
    if (process.platform === "darwin") {
      const vm = run("vm_stat", []).stdout;
      const pageSize = Number(/page size of (\d+) bytes/.exec(vm)?.[1]);
      const pages = (name: string) => Number(new RegExp(`^Pages ${name}:\\s+(\\d+)`, "m").exec(vm)?.[1] ?? 0);
      if (pageSize) available = pageSize * (pages("free") + pages("inactive") + pages("speculative"));
    }
    return { availMiB: Math.floor(available / 1048576), totalMiB: Math.floor(os.totalmem() / 1048576), swapMiB: 0 };
  }
  const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(text)?.[1] ?? 0);
  return { availMiB: Math.floor(kb("MemAvailable") / 1024), totalMiB: Math.floor(kb("MemTotal") / 1024), swapMiB: Math.floor(kb("SwapTotal") / 1024) };
}
function serviceUrl(name: string): string {
  const result = run("pnpm", ["exec", "portless", "get", name], { cwd: REPO });
  if (result.status !== 0) die(`portless get ${name}: ${result.stderr}`);
  return new URL(result.stdout.trim()).origin;
}
function routePort(origin: string): string {
  const result = run("pnpm", ["exec", "portless", "list"], { cwd: REPO });
  const line = result.stdout.split("\n").find((l) => l.trim().startsWith(`${origin} `));
  return line?.match(/->\s+localhost:(\d+)/)?.[1] ?? "0";
}
function dockerPort(w: WebRun, service: string, port = "8123"): string {
  const result = compose(w, ["port", service, port]);
  if (result.status !== 0) die(`cannot resolve ${service}: ${result.stderr}`);
  return result.stdout.trim().split(":").at(-1) ?? die(`missing ${service} port`);
}
async function cmdWebLaunch(argv: string[]): Promise<number> {
  let product: "app" | "cloud" = "cloud";
  let idArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--app") {
      const value = argv[++i];
      if (value !== "app" && value !== "cloud") die("--app must be app or cloud");
      product = value;
    } else if (argv[i] !== "--ignore-memory") {
      if (argv[i].startsWith("--") || idArg) die(`unexpected launch argument: ${argv[i]}`);
      idArg = argv[i];
    }
  }
  const mem = meminfo();
  console.log(`memory: ${mem.availMiB} MiB free/available of ${mem.totalMiB} MiB; reserving ${WEB_RUN_MIB} MiB for the complete development graph`);
  if (mem.availMiB < WEB_RUN_MIB && !argv.includes("--ignore-memory")) die("not enough free memory; close other stacks or pass --ignore-memory");
  if (readPointer(WEB_STATE)) die("a web run is already selected; run web-cleanup first");
  const dockerBin = requireDocker();
  if (Number(process.versions.node.split(".")[0]) < 24) die("pnpm dev requires Node >= 24");
  if (!existsSync(path.join(REPO, "node_modules"))) {
    if (runInherit("pnpm", ["install", "--frozen-lockfile"], { cwd: REPO }) !== 0) die("dependency installation failed");
  }
  const id = parseRunId(idArg ?? defaultRunId());
  const dir = webDir(id), art = webArt(id);
  if (existsSync(dir)) die(`scratch directory already exists: ${dir}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(art, { recursive: true });
  const prefix = `verify-${createHash("sha256").update(`${REPO}:${id}`).digest("hex").slice(0, 12)}`;
  const names = { app: `${prefix}-app`, cloud: `${prefix}-cloud`, appIngest: `${prefix}-app-ingest`, cloudIngest: `${prefix}-cloud-ingest` };
  // Ask the same Portless wrapper used by development for its public local CA.
  const caProbe = run("pnpm", ["exec", "portless", "run", "--name", `${prefix}-bootstrap`, "node", "-e", "console.log('VERIFY_CA='+(process.env.NODE_EXTRA_CA_CERTS||''))"], { cwd: REPO });
  if (caProbe.status !== 0) die(`Portless is not ready: ${caProbe.stderr || caProbe.stdout}`);
  const ca = /^VERIFY_CA=(.*)$/m.exec(caProbe.stdout)?.[1] ?? "";
  const urls = { app: serviceUrl(names.app), cloud: serviceUrl(names.cloud), appIngest: serviceUrl(names.appIngest), cloudIngest: serviceUrl(names.cloudIngest) };
  const vars = {
    WEB_RUN_ID: id, WEB_APP: product, WEB_PROJECT: `verify-everr-${prefix.slice(7)}`,
    WEB_ORIGIN: urls[product], WEB_PORT: "0", CLICKHOUSE_URL: "http://127.0.0.1:0",
    APP_ORIGIN: urls.app, CLOUD_ORIGIN: urls.cloud,
    APP_OTLP_ORIGIN: urls.appIngest, CLOUD_OTLP_ORIGIN: urls.cloudIngest,
    OTLP_HTTP_ORIGIN: product === "app" ? urls.appIngest : urls.cloudIngest,
    SDK_PAGE_ORIGIN: `http://127.0.0.1:${await freePort()}`, PORTLESS_CA: ca,
    DEV_APP_NAME: names.app, DEV_CLOUD_NAME: names.cloud,
    DEV_APP_INGEST_NAME: names.appIngest, DEV_CLOUD_INGEST_NAME: names.cloudIngest,
    WEB_GITHUB: "true",
    DEV_APP_GRPC_PORT: String(await freePort()), DEV_CLOUD_GRPC_PORT: String(await freePort()),
    DEV_APP_GITHUB_PORT: String(await freePort()), DEV_CLOUD_GITHUB_PORT: String(await freePort()),
  };
  Object.assign(vars, {
    APP_GITHUB_ORIGIN: `http://127.0.0.1:${vars.DEV_APP_GITHUB_PORT}`,
    CLOUD_GITHUB_ORIGIN: `http://127.0.0.1:${vars.DEV_CLOUD_GITHUB_PORT}`,
    APP_OTLP_GRPC_ORIGIN: `http://127.0.0.1:${vars.DEV_APP_GRPC_PORT}`,
    CLOUD_OTLP_GRPC_ORIGIN: `http://127.0.0.1:${vars.DEV_CLOUD_GRPC_PORT}`,
    OTLP_GRPC_ORIGIN: `http://127.0.0.1:${product === "app" ? vars.DEV_APP_GRPC_PORT : vars.DEV_CLOUD_GRPC_PORT}`,
  });
  writeEnvFile(path.join(dir, "run.env"), vars);
  writeFileSync(WEB_STATE, `${id}\n`);
  let w = parseWebRun(id, dockerBin);
  snapshotCollectors(w);
  const otlp = "http://127.0.0.1:9";
  const env = { ...process.env, ...vars, DEV_STATE_DIR: path.join(dir, "state"), COMPOSE_PROJECT_NAME: vars.WEB_PROJECT,
    OTEL_EXPORTER_OTLP_ENDPOINT: otlp, VITE_EVERR_INGEST_ENDPOINT: otlp, EVERR_INGEST_KEY: "" };
  const log = path.join(dir, "web.log"), logFd = openSync(log, "w");
  const args = ["dev", "-f", path.join(REPO, "process-compose.mail.yaml")];
  const server = spawn("pnpm", args, { cwd: REPO, env, detached: true, stdio: ["ignore", logFd, logFd] });
  closeSync(logFd);
  const pid = server.pid ?? die("could not start pnpm dev");
  writeFileSync(path.join(dir, "web.pgid"), `${pid}\n`);
  server.on("error", (error) => console.error(error.message));
  server.unref();
  writeFileSync(path.join(art, "run.txt"), `run: ${id}\nselected_app: ${product}\ncommand: pnpm ${args.join(" ")}\nproject: ${vars.WEB_PROJECT}\ngit_head: ${run("git", ["-C", REPO, "rev-parse", "HEAD"]).stdout.trim()}\nlaunched_at: ${stamp()}\n`);
  const deadline = Date.now() + 600000;
  console.log(`launching pnpm dev: ${urls.app} + ${urls.cloud} (selected ${product})`);
  let nextUpdate = 0;
  while (!["databases", "mailpit", "app", "cloud", "collector-app", "collector-cloud"].every((name) => processReady(w, name))) {
    if (!isAlive(pid) || Date.now() > deadline) {
      tail(log, 30);
      die("pnpm dev did not reach readiness; run web-cleanup to preserve logs and remove this run");
    }
    if (Date.now() > nextUpdate) { console.log("waiting for Process Compose readiness; startup log: " + log); nextUpdate = Date.now() + 30000; }
    await sleep(1000);
  }
  vars.WEB_PORT = routePort(vars.WEB_ORIGIN);
  vars.CLICKHOUSE_URL = `http://127.0.0.1:${dockerPort(w, `clickhouse-${product}`)}`;
  const more = { MAILPIT_ORIGIN: `http://127.0.0.1:${dockerPort(w, "mailpit", "8025")}`, APP_CLICKHOUSE_URL: `http://127.0.0.1:${dockerPort(w, "clickhouse-app")}`, CLOUD_CLICKHOUSE_URL: `http://127.0.0.1:${dockerPort(w, "clickhouse-cloud")}` };
  if (vars.WEB_PORT === "0") die("Portless did not report the selected app's backing port");
  writeEnvFile(path.join(dir, "run.env"), { ...vars, ...more });
  copyFileSync(path.join(dir, "run.env"), path.join(art, "run.env"));
  w = parseWebRun(id, dockerBin);
  if (appliedMigrations(w) !== expectedMigrations()) die("selected app migrations did not finish");
  writeFileSync(path.join(dir, "pids"), `web_port_pids=${portPids(w.port)}\n`);
  console.log(`WEB READY run=${id} app=${product} url=${w.origin}`);
  return 0;
}
async function cmdWebDoctor(): Promise<number> {
  const w = webLoad();
  let ok = true;
  const check = (label: string, pass: boolean) => { console.log(`${pass ? "ok  " : "FAIL"} ${label}`); if (!pass) ok = false; };
  for (const service of ["databases", "mailpit", "app", "cloud", "collector-app", "collector-cloud"]) check(`Process Compose ${service} ready`, processReady(w, service));
  const ps = compose(w, ["ps", "--format", "{{.Service}} {{.State}}"]);
  for (const service of ["postgres", "mailpit", "clickhouse-app", "clickhouse-cloud"]) check(`${service} running`, ps.stdout.split("\n").includes(`${service} running`));
  for (const product of ["app", "cloud"] as const) {
    check(`${product} GitHub receiver validates signatures`, (await http(`${w.vars[product === "app" ? "APP_GITHUB_ORIGIN" : "CLOUD_GITHUB_ORIGIN"]}/webhook/github`)).status === 400);
    check(`${product} HTTP health`, (await http(`${w.vars[product === "app" ? "APP_ORIGIN" : "CLOUD_ORIGIN"]}/api/health`)).ok);
    const url = w.vars[product === "app" ? "APP_CLICKHOUSE_URL" : "CLOUD_CLICKHOUSE_URL"];
    check(`${product} tenant policies`, (await rowPolicies(url)) === expectedRowPolicies(product));
    check(`${product} collector config matches source`, readText(collectorConfig(product)) === readText(path.join(w.art, `collector-${product}.yaml`)));
  }
  check("selected collector enforces HTTP authentication", (await otlpUnauthStatus(w)) === 401);
  check("selected collector enforces gRPC authentication", (await grpcUnauthStatus(w)) === 16);
  const pre = await corsPreflight(w);
  check("selected collector CORS preflight", pre.status === 204 && pre.allowOrigin !== "");
  check("shared application migrations applied", appliedMigrations(w) === expectedMigrations());
  check("pnpm dev process group alive", isAlive(Number(readPointer(path.join(w.dir, "web.pgid")))));
  const oldPids = (readText(path.join(w.dir, "pids")) ?? "").split("=")[1]?.trim();
  check("selected app still owns its backing port", Boolean(oldPids) && oldPids === portPids(w.port));
  const log = readText(path.join(w.dir, "web.log")) ?? "";
  check("collector schema detection succeeded", !SCHEMA_ERROR_RE.test(log));
  check("agent-browser available", Boolean(agentBrowserVersion()));
  console.log(ok ? "WEB DOCTOR OK" : "WEB DOCTOR FAILED");
  return ok ? 0 : 1;
}

function cmdWebEnv(): number {
  const w = webLoad();
  process.stdout.write(readText(path.join(w.dir, "run.env")) ?? "");
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
    APP_WEB: w.vars.APP_ORIGIN,
    CLOUD_WEB: w.vars.CLOUD_ORIGIN,
    WEB_APP: w.product,
    SDK_PAGE_ORIGIN: w.vars.SDK_PAGE_ORIGIN ?? "",
    ...(existsSync(path.join(w.dir, "sdk-page.url")) ? { SDK_URL: (readText(path.join(w.dir, "sdk-page.url")) ?? "").trim() } : {}),
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
 * from the selected application's real configuration, exactly as GitHub signs deliveries. */
async function cmdWebWebhook([label, event, payloadArg]: string[]): Promise<number> {
  const w = webLoad();
  const name = required(label, "label");
  const ev = required(event, "event");
  const file = required(payloadArg, "payload file");
  const payload = existsSync(file) ? file : path.join(SCRIPT_DIR, file);
  if (w.vars.WEB_GITHUB !== "true") die("GitHub is disabled in this older run; relaunch using the current development configuration");
  const { loadEnv } = await import("vite");
  const secret = loadEnv("development", path.join(REPO, "packages", w.product), "").GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) die("GITHUB_APP_WEBHOOK_SECRET is required for signed webhook verification");
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
    "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", `everr_${w.product}`, "-v", "ON_ERROR_STOP=1",
    "-c", "SET default_transaction_read_only = on", "-c", query,
  ]);
  return printDbResult(out, runToFiles(cmd, args, { stdout: path.join(out, "stdout"), stderr: path.join(out, "stderr") }, { env: composeEnv() }));
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
    attributes: [str("service.name", SEED.service), str("deployment.environment.name", "verify"), str("everr.tenant.id", SEED.spoofTenant)],
  };
  const scope = { name: "verify-everr-seed" };
  const traceId = hex(16);
  const [root, db, charge] = [hex(8), hex(8), hex(8)];
  const span = (spanId: string, parentSpanId: string, name: string, startAgo: number, endAgo: number, error: boolean) => ({
    traceId, spanId, parentSpanId, name, kind: parentSpanId ? 3 : 2,
    startTimeUnixNano: ago(startAgo), endTimeUnixNano: ago(endAgo),
    attributes: [str("everr.verify.seed", "1")],
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
// A full key. The /api-keys list shows only `ek_` plus a few characters and `...`; {20,} never matches that.
const KEY_RE = /\bek_[A-Za-z0-9_-]{20,}/;

/** Keep an issued key out of the evidence: read text containing it on stdin (for example
 * `agent-browser get text body` on the "Copy your key now" dialog), store it in the scratch dir. */
function cmdWebKeySave([name]: string[]): number {
  const w = webLoad();
  const file = keyFile(w, required(name, "key name"));
  const key = readFileSync(0, "utf8").match(KEY_RE)?.[0] ?? die("no ek_ key on stdin");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${key}\n`, { mode: 0o600 });
  console.log(`saved key '${name}' (${key.slice(0, 7)}...) to ${file}`);
  return 0;
}

function readKey(w: WebRun, args: string[]): string {
  let file = keyFile(w, "secret");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--key-name") file = keyFile(w, required(args[++i], "--key-name value"));
    else if (args[i] === "--key-file") file = required(args[++i], "--key-file value");
    else die(`unknown argument ${args[i]}`);
  }
  return (readText(file) ?? "").match(KEY_RE)?.[0] ?? die(`no ek_ key in ${file}; save one with 'agent-browser get text body | $V web-key-save <name>' (web-api-keys.md)`);
}

async function cmdWebSeed(args: string[]): Promise<number> {
  const w = webLoad();
  const out = path.join(w.art, "seed");
  if (existsSync(path.join(out, "seed.txt"))) die(`this run is already seeded (${out}); the recipe's counts assume one seed per run`);
  const key = readKey(w, args);
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
  if (!ok) die(`ingest did not answer as expected; see ${summary} and this run's web.log`);

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
      die(`seeded rows not in ClickHouse after 60s (got ${JSON.stringify(rows)}); see this run's web.log`);
    }
    await sleep(1000);
  }
  writeFileSync(path.join(out, "rows.json"), `${JSON.stringify(rows, null, 2)}\n`);
  // The key's organization (better-auth apikey.reference_id) is the tenant every row must carry.
  const [cmd, psqlArgs] = composeArgs(w, [
    "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", `everr_${w.product}`, "-tA", "-c",
    // better-auth stores the key hashed plus its first characters in `start`; the key matched
    // /ek_[A-Za-z0-9_-]+/ above, so it is safe to inline.
    `select reference_id from apikey where start <> '' and strpos('${key}', start) = 1 order by created_at desc limit 1`,
  ]);
  const org = run(cmd, psqlArgs, { env: composeEnv() }).stdout.trim();
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

async function cmdWebCollectorRestart(): Promise<number> {
  const w = webLoad();
  const result = pc(w, ["process", "restart", `collector-${w.product}`]);
  if (result.status !== 0) die(`collector restart failed: ${result.stderr || result.stdout}`);
  await waitCollector(w);
  snapshotCollectors(w, [w.product]);
  console.log(`COLLECTOR READY app=${w.product} otlp=${w.otlp}`);
  return 0;
}

function esbuildBin(): string {
  const pnpmDir = path.join(REPO, "node_modules/.pnpm");
  const versions = (existsSync(pnpmDir) ? readdirSync(pnpmDir) : [])
    .filter((d) => /^esbuild@\d/.test(d))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const d of versions.reverse()) {
    const bin = path.join(pnpmDir, d, "node_modules/esbuild/bin/esbuild");
    if (existsSync(bin)) return bin;
  }
  return die("no esbuild in node_modules/.pnpm (it comes with the repo's Vite toolchain); run 'pnpm install'");
}

function stopGroup(pgidFile: string): void {
  const pgid = Number(readPointer(pgidFile));
  if (pgid > 0) {
    try {
      process.kill(-pgid, "SIGTERM");
    } catch {}
  }
  rmSync(pgidFile, { force: true });
}

/** A minimal integrator page for @everr/otel-web built from this checkout's source. */
async function cmdWebSdkPage(args: string[]): Promise<number> {
  const w = webLoad();
  const local = args.includes("--local");
  const src = path.join(REPO, "packages/otel-web/src");
  if (!existsSync(path.join(src, "index.ts"))) die(`no ${src}/index.ts in this checkout`);
  const recordingSrc = path.join(src, "recording.ts");
  const recordingOn = existsSync(recordingSrc);
  const pageOrigin = w.vars.SDK_PAGE_ORIGIN || die(`${w.dir}/run.env has no SDK_PAGE_ORIGIN (relaunch)`);
  let otlp = w.otlp;
  let key = "";
  if (local) {
    const cliRun = readPointer(path.join(STATE_DIR, "current"));
    const cliEnv = cliRun ? path.join(SCRATCH_ROOT, cliRun, "env") : "";
    otlp = (cliEnv && readEnvFile(cliEnv).EVERR_OTLP_HTTP_ORIGIN) || die("--local needs a live CLI run ('verify-everr launch')");
  } else {
    key = readKey(w, ["--key-name", "public"]);
  }
  const dir = path.join(w.dir, "sdk-page");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const template = readFileSync(path.join(SCRIPT_DIR, "sdk-page/entry.template.ts"), "utf8");
  const entry = template
    .replace("__OTEL_WEB_INDEX__", path.join(src, "index.ts"))
    .replace(
      "__RECORDING_IMPORT__",
      recordingOn
        ? `import { emitRecording, recording } from ${JSON.stringify(recordingSrc)};`
        : "const recording: any = undefined;\nconst emitRecording: any = undefined;",
    );
  writeFileSync(path.join(dir, "entry.ts"), entry);
  copyFileSync(path.join(SCRIPT_DIR, "sdk-page/index.html"), path.join(dir, "index.html"));
  const out = freshDir(path.join(w.art, "sdk-page"));
  const build = runToFiles(esbuildBin(), [path.join(dir, "entry.ts"), "--bundle", "--format=esm", "--splitting", `--outdir=${dir}`, "--target=es2022"], {
    stdout: path.join(out, "build.log"),
  }, { cwd: path.join(REPO, "packages/otel-web") });
  if (build !== 0) {
    tail(path.join(out, "build.log"), 20);
    die("esbuild failed");
  }
  copyFileSync(path.join(dir, "entry.ts"), path.join(out, "entry.ts"));
  copyFileSync(path.join(dir, "index.html"), path.join(out, "index.html"));
  const pgidFile = path.join(w.dir, "sdk-page.pgid");
  stopGroup(pgidFile);
  const port = portOf(pageOrigin);
  const deadlineFree = Date.now() + 5000;
  while (portPids(port) && Date.now() < deadlineFree) await sleep(200);
  const logFd = openSync(path.join(w.dir, "sdk-page.log"), "w");
  const server = spawn(process.execPath, [path.join(SCRIPT_DIR, "sdk-page/serve.ts"), dir, port], { detached: true, stdio: ["ignore", logFd, logFd] });
  closeSync(logFd);
  writeFileSync(pgidFile, `${server.pid ?? die("could not start the SDK page server")}\n`);
  server.unref();
  const deadline = Date.now() + 10000;
  while (!(await http(`${pageOrigin}/index.html`, { timeoutMs: 2000 })).ok) {
    if (Date.now() >= deadline) die(`SDK page server did not answer on ${pageOrigin}; see ${w.dir}/sdk-page.log`);
    await sleep(200);
  }
  const query = new URLSearchParams({ otlp, ...(key ? { key } : {}) });
  writeFileSync(path.join(w.dir, "sdk-page.url"), `${pageOrigin}/index.html?${query}\n`);
  const chunks = readdirSync(dir).filter((f) => f.endsWith(".js"));
  writeFileSync(path.join(out, "page.txt"), `origin: ${pageOrigin}\notlp: ${otlp}\nkey: ${key ? `${key.slice(0, 7)}... (public)` : "none (local collector)"}\nrecording: ${recordingOn ? "on" : "absent in this checkout"}\nchunks: ${chunks.join(" ")}\n`);
  console.log(`SDK PAGE READY origin=${pageOrigin} otlp=${otlp} key=${key ? "public" : "none"} recording=${recordingOn ? "on" : "absent"} chunks=${chunks.length}`);
  console.log("re-run: eval \"$($V web-browser-env)\" to get SDK_URL");
  return 0;
}

/** Playwright video of a scripted journey (scripts/record.ts), defaulted from the current web run:
 * --base-url = this run's app, --storage-state = this run's agent-browser session (so the signed-in
 * user carries over), --out = <evidence>/video. Any record.ts argument given explicitly wins. */
function cmdWebRecord(args: string[]): number {
  const w = webLoad();
  if (!args.includes("--steps")) die("web-record needs --steps <file> (example: scripts/record-examples/explore-seeded.ts)");
  const extra: string[] = [];
  if (!args.includes("--base-url")) extra.push("--base-url", w.origin);
  if (!args.includes("--out")) extra.push("--out", path.join(w.art, "video"));
  if (!args.includes("--storage-state") && !args.includes("--cookie")) {
    const state = path.join(w.dir, "browser-state.json");
    const saved = run("agent-browser", ["state", "save", state], {
      env: { ...process.env, AGENT_BROWSER_SESSION: browserSession(`web-${w.id}`) },
    });
    if (saved.status !== 0 || !existsSync(state)) {
      die(`could not save this run's browser session (${saved.stderr.trim() || saved.stdout.trim()}); sign up first (web-auth.md) or pass --storage-state/--cookie`);
    }
    extra.push("--storage-state", state);
  }
  const r = spawnSync(process.execPath, [path.join(SCRIPT_DIR, "record.ts"), ...extra, ...args], { stdio: "inherit" });
  return r.status ?? 1;
}

/** Print a saved full key, for `-H "Authorization: Bearer $($V web-key secret)"` style use. */
function cmdWebKey([name]: string[]): number {
  const w = webLoad();
  process.stdout.write(`${readKey(w, ["--key-name", required(name, "key name")])}\n`);
  return 0;
}

/** agent-browser in this run's session, captured. */
function ab(w: WebRun, args: string[]): Proc {
  return run("agent-browser", args, {
    env: { ...process.env, AGENT_BROWSER_SESSION: browserSession(`web-${w.id}`), AGENT_BROWSER_DEFAULT_TIMEOUT: "90000" },
  });
}

function abOk(w: WebRun, args: string[], what: string): string {
  const r = ab(w, args);
  if (r.status !== 0) die(`${what} failed: agent-browser ${args.join(" ")}: ${(r.stderr || r.stdout).trim().slice(0, 300)}`);
  return r.stdout;
}

/** Same files as the recipes' `ab_save`: <evidence>/web/<label>.{png,url,txt}. */
function abSave(w: WebRun, label: string, caption?: string): void {
  const base = path.join(w.art, "web", label);
  mkdirSync(path.dirname(base), { recursive: true });
  if (caption) writeFileSync(`${base}.caption`, `${caption}\n`);
  run("sleep", ["0.7"]); // let the compositor paint the new DOM (see printBrowserEnv)
  abOk(w, ["screenshot", `${base}.png`], `screenshot ${label}`);
  writeFileSync(`${base}.url`, ab(w, ["get", "url"]).stdout);
  writeFileSync(`${base}.txt`, ab(w, ["get", "text", "body"]).stdout);
}

/** Focus a button by its visible text and press Enter: the consent banner covers some buttons, so a
 * pointer click is refused. */
function abPressButton(w: WebRun, text: string): void {
  const js = `(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)}) && !x.disabled); if (!b) return "missing"; b.focus(); return "focused"; })()`;
  const out = abOk(w, ["eval", js], `focus '${text}'`);
  if (!out.includes("focused")) die(`no enabled button '${text}' on ${ab(w, ["get", "url"]).stdout.trim()}`);
  abOk(w, ["press", "Enter"], `press Enter on '${text}'`);
}

export const VIEWPORT = { width: 1280, height: 800 };
const BANNER_TEXT = "We use analytics";

/** Screenshots must not be half-covered by the consent banner: answer it with `Deny` (no analytics
 * storage, the least side effect), once per browser session (the choice is kept in its storage). */
function dismissBanner(w: WebRun): boolean {
  if (!ab(w, ["get", "text", "body"]).stdout.includes(BANNER_TEXT)) return false;
  abOk(w, ["find", "role", "button", "click", "--name", "Deny"], "click Deny on the consent banner");
  abOk(w, ["wait", "--fn", `!document.body.innerText.includes(${JSON.stringify(BANNER_TEXT)})`], "wait for the banner to close");
  return true;
}

/** Finish Home onboarding (4 steps) the way a user does, so later recipes see the Home dashboard.
 * Also sets the evidence viewport and dismisses the consent banner for the rest of the session. */
function cmdWebOnboard(): number {
  const w = webLoad();
  abOk(w, ["set", "viewport", String(VIEWPORT.width), String(VIEWPORT.height)], "set viewport");
  abOk(w, ["open", `${w.origin}/`], "open /");
  abOk(w, ["wait", "--text", "Home"], "wait for the app shell");
  if (dismissBanner(w)) console.log("consent banner: answered Deny");
  const body = () => ab(w, ["get", "text", "body"]).stdout;
  abOk(w, ["wait", "--fn", "document.body.innerText.includes('Welcome to Everr') || document.body.innerText.includes('Usage by signal')"], "wait for Home");
  if (!body().includes("Welcome to Everr")) {
    abSave(w, "onboard-00-already-done");
    console.log("ONBOARDED already (Home shows the usage dashboard)");
    return 0;
  }
  const steps: [string, string][] = [
    ["Continue", "Step 2 of 4"],
    ["Check my telemetry", "Step 3 of 4"],
    ["I can see my local telemetry", "Step 4 of 4"],
    ["Finish onboarding", "Usage by signal"],
  ];
  abSave(w, "onboard-01-step-1", "Home onboarding, step 1 of 4 (Install Everr), banner dismissed");
  steps.forEach(([button, next], i) => {
    abPressButton(w, button);
    abOk(w, ["wait", "--text", next], `wait for '${next}' after '${button}'`);
    const last = i === steps.length - 1;
    abSave(
      w,
      `onboard-0${i + 2}-${last ? "done" : `step-${i + 2}`}`,
      last ? "Onboarding finished: Home shows the usage dashboard" : `After '${button}': onboarding ${next}`,
    );
  });
  const [cmd, psqlArgs] = composeArgs(w, [
    "exec", "-T", "postgres", "psql", "-U", "postgres", "-d", `everr_${w.product}`, "-tA", "-c",
    "select count(*) from organization where metadata::jsonb ->> 'onboardingCompleted' = 'true'",
  ]);
  const done = run(cmd, psqlArgs, { env: composeEnv() }).stdout.trim();
  writeFileSync(path.join(w.art, "web", "onboard-db.txt"), `organizations with onboardingCompleted=true: ${done}\n`);
  if (done === "0" || done === "") die("Home shows the dashboard but no organization has onboardingCompleted=true");
  console.log(`ONBOARDED orgs_completed=${done} (evidence web/onboard-*)`);
  return 0;
}

/** POST an as-code body to /api/apply with a saved key that has Manage as code. */
async function cmdWebApply(args: string[]): Promise<number> {
  const w = webLoad();
  const bodyFile = path.resolve(required(args[0], "body.json"));
  const rest = args.slice(1);
  const dryRun = rest.includes("--dry-run");
  const key = readKey(w, rest.filter((a) => a !== "--dry-run"));
  let body: unknown;
  try {
    body = JSON.parse(readFileSync(bodyFile, "utf8"));
  } catch (e) {
    die(`${bodyFile}: not JSON (${(e as Error).message})`);
  }
  if (!isRecord(body) || typeof body.repoid !== "string" || !isRecord(body.state)) die(`${bodyFile}: need {"repoid": ..., "state": {"dashboards": [], "runbooks": [], "alerts": []}}`);
  if (dryRun) body.dryRun = true;
  const label = `apply-${path.basename(bodyFile).replace(/\.json$/, "")}${dryRun ? "-dry-run" : ""}`;
  const out = freshDir(path.join(w.art, "http", label));
  writeFileSync(path.join(out, "request.json"), `${JSON.stringify(body, null, 2)}\n`);
  writeFileSync(path.join(out, "command.txt"), `POST ${w.origin}/api/apply  Authorization: Bearer ${key.slice(0, 7)}... (redacted)  body: request.json\n`);
  const res = await fetch(`${w.origin}/api/apply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  writeFileSync(path.join(out, "status"), `${res.status}\n`);
  writeFileSync(path.join(out, "body"), text);
  console.log(`POST /api/apply (${path.basename(bodyFile)}${dryRun ? ", dry run" : ""}) -> ${res.status}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const results = isRecord(parsed) && Array.isArray(parsed.results) ? parsed.results : [];
  for (const r of results) {
    if (!isRecord(r)) continue;
    const list = (k: string) => (Array.isArray(r[k]) ? (r[k] as unknown[]).join(",") : "");
    console.log(`  ${String(r.kind)}: created [${list("created")}] updated [${list("updated")}] deleted [${list("deleted")}]`);
  }
  if (res.status !== 200) {
    console.log(text.slice(0, 600));
    console.log(`evidence: ${out}`);
    return 1;
  }
  console.log(`APPLIED status=200 evidence=${path.relative(REPO, out)}`);
  return 0;
}

/** `/_serverFn/<id>`: id is base64url JSON {file, export}; the export ends in _createServerFn_handler. */
function serverFnName(url: string): string | undefined {
  const id = /\/_serverFn\/([^?/#]+)/.exec(url)?.[1];
  if (!id) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(id, "base64url").toString("utf8"));
    if (isRecord(decoded) && typeof decoded.export === "string") return decoded.export.replace(/_createServerFn_handler$/, "");
  } catch {}
  return `undecodable:${id.slice(0, 12)}`;
}

/** Page errors of this session. Plain `agent-browser errors` prints bare "✗" lines in 0.39.1; the
 * JSON form carries the text. The list only grows (`errors --clear` does not clear it). */
function pageErrors(w: WebRun): string[] {
  try {
    const parsed: unknown = JSON.parse(ab(w, ["--json", "errors"]).stdout);
    const list = isRecord(parsed) && isRecord(parsed.data) && Array.isArray(parsed.data.errors) ? parsed.data.errors : [];
    return list.map((e) => (isRecord(e) && typeof e.text === "string" ? e.text.split("\n")[0] : String(e)));
  } catch {
    return [];
  }
}

// React's site-wide SSR mismatch, present on every page of the app at e138f4d (see SKILL.md Browser).
const HYDRATION_RE = /^Error: Hydration failed because the server rendered HTML didn't match the client/;

/** Measure what the current page does on its own for N seconds: requests, server functions, errors. */
async function cmdWebNet(args: string[]): Promise<number> {
  const w = webLoad();
  const reload = args.includes("--reload");
  const [label, secondsArg] = args.filter((a) => a !== "--reload");
  const name = required(label, "label");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) die(`invalid label '${name}'`);
  const seconds = Number(required(secondsArg, "seconds"));
  if (!(seconds > 0 && seconds <= 600)) die("seconds must be in (0, 600]");
  const out = path.join(w.art, "net");
  mkdirSync(out, { recursive: true });
  const page = ab(w, ["get", "url"]).stdout.trim();
  // `errors --clear` does not clear in agent-browser 0.39.1: compare counts instead.
  const errorsBefore = pageErrors(w).length;
  abOk(w, ["network", "requests", "--clear"], "clear network log");
  if (reload) abOk(w, ["reload"], "reload");
  await sleep(seconds * 1000);
  const requests = abOk(w, ["network", "requests"], "read network log");
  const added = pageErrors(w).slice(errorsBefore);
  const newErrors = added.length;
  const hydration = added.filter((e) => HYDRATION_RE.test(e)).length;
  writeFileSync(path.join(out, `${name}.requests.txt`), requests);
  const counts = new Map<string, number>();
  let total = 0;
  for (const line of requests.split("\n")) {
    const m = /\]\s+([A-Z]+)\s+(\S+)/.exec(line);
    if (!m) continue;
    total++;
    const fn = serverFnName(m[2]);
    if (fn) counts.set(`${m[1]} ${fn}`, (counts.get(`${m[1]} ${fn}`) ?? 0) + 1);
  }
  const fnTotal = [...counts.values()].reduce((a, b) => a + b, 0);
  const lines = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${String(n).padStart(5)}  ${k}`);
  const summary = [
    `page: ${page}`,
    `window: ${seconds}s${reload ? " (from a reload)" : " (page left as is)"}`,
    `requests: ${total}`,
    `serverFn calls: ${fnTotal}`,
    ...lines,
    `new page errors: ${newErrors}, of which known site-wide hydration mismatch: ${hydration}`,
    "",
  ].join("\n");
  writeFileSync(path.join(out, `${name}.serverfn.txt`), summary);
  writeFileSync(path.join(out, `${name}.errors.txt`), added.map((e) => `${e}\n`).join(""));
  process.stdout.write(summary);
  console.log(`NET label=${name} seconds=${seconds} requests=${total} serverfn=${fnTotal} new_errors=${newErrors} hydration=${hydration} evidence=${path.relative(REPO, out)}/${name}.*`);
  return 0;
}

/** One markdown file with every image and video of the run, captioned, linked relatively:
 * <evidence>/report.md. Captions come from <label>.caption (ab_save's 2nd argument), else the URL. */
function cmdWebReport(args: string[]): number {
  const id = args[0] ? parseRunId(args[0]) : readPointer(WEB_STATE) || die("no web run (pass a run id to report on a cleaned-up run)");
  const art = webArt(id);
  if (!existsSync(art)) die(`no evidence dir ${art}`);
  const lines: string[] = [`# verify-everr web run ${id}`, ""];
  const runTxt = readText(path.join(art, "run.txt"));
  if (runTxt) lines.push("```", runTxt.trim(), "```", "");
  const rel = (f: string) => path.relative(art, f).split(path.sep).map(encodeURIComponent).join("/");
  const videoDir = path.join(art, "video");
  const videos = existsSync(videoDir) ? readdirSync(videoDir).filter((f) => f.endsWith(".mp4")).sort() : [];
  if (videos.length) {
    lines.push("## Videos", "");
    for (const v of videos) {
      const stem = v.replace(/\.mp4$/, "");
      const probe = readText(path.join(videoDir, `${stem}.probe.txt`)) ?? "";
      const dur = /duration=([\d.]+)/.exec(probe)?.[1];
      lines.push(`### ${stem}`, "", `[${v}](${rel(path.join(videoDir, v))})${dur ? ` (${Number(dur).toFixed(1)}s)` : ""}`, "");
      const timeline = readText(path.join(videoDir, `${stem}.timeline.txt`));
      if (timeline) lines.push("```", timeline.trim(), "```", "");
      for (const f of readdirSync(videoDir).filter((x) => x.startsWith(`${stem}-`) && x.endsWith(".png")).sort()) {
        lines.push(`![${f}](${rel(path.join(videoDir, f))})`, "", `*${f.slice(stem.length + 1, -4)}*`, "");
      }
    }
  }
  const shotsDir = path.join(art, "web");
  const shots = existsSync(shotsDir) ? readdirSync(shotsDir).filter((f) => f.endsWith(".png")).sort() : [];
  let uncaptioned = 0;
  if (shots.length) {
    lines.push("## Screenshots", "");
    for (const s of shots) {
      const label = s.slice(0, -4);
      const caption = (readText(path.join(shotsDir, `${label}.caption`)) ?? "").trim();
      const url = (readText(path.join(shotsDir, `${label}.url`)) ?? "").trim();
      if (!caption) uncaptioned++;
      lines.push(`### ${label}`, "", caption || "*(no caption: add one with `ab_save <label> \"<claim>\"`)*", "", url ? `\`${url}\`` : "", "", `![${label}](${rel(path.join(shotsDir, s))})`, "");
    }
  }
  lines.push(
    "## Checklist",
    "",
    "- [ ] Each image above was opened and shows what its caption claims (data rendered, no banner over it).",
    "- [ ] Every UI claim in the report points at one of these images or the video; claims without one are marked unverified.",
    "",
  );
  const out = path.join(art, "report.md");
  writeFileSync(out, `${lines.join("\n")}\n`);
  console.log(`REPORT ${path.relative(REPO, out)} videos=${videos.length} screenshots=${shots.length} uncaptioned=${uncaptioned}`);
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
  let complete = true;
  const failed = (message: string) => { complete = false; teeAppend(cleanupLog, message); };
  if (existsSync(path.join(dir, "run.env"))) {
    const w = parseWebRun(runId, dockerCmd() ?? ["docker"]);
    // Stop the owned Process Compose instance before removing its project.
    const pgidFile = path.join(dir, "web.pgid");
    const pgid = Number(readPointer(pgidFile));
    if (pgid > 0 && isAlive(pgid)) {
      const signal = (sig: NodeJS.Signals) => {
        try {
          process.kill(-pgid, sig);
        } catch {}
      };
      const stopped = pc(w, ["down"]);
      if (stopped.status !== 0) signal("SIGINT");
      const deadline = Date.now() + 90000;
      while (isAlive(pgid) && Date.now() < deadline) await sleep(500);
      if (isAlive(pgid)) {
        signal("SIGKILL");
        teeAppend(cleanupLog, "WARN supervisor needed SIGKILL after 90s");
        await sleep(500);
      }
    }
    if (pgid > 0 && isAlive(pgid)) failed("Supervisor is still running");
    else rmSync(pgidFile, { force: true });
    stopGroup(path.join(dir, "sdk-page.pgid"));
    await closeBrowser(browserSession(`web-${runId}`), cleanupLog);
    const webLog = path.join(dir, "web.log");
    if (existsSync(webLog)) copyFileSync(webLog, path.join(art, "web.log"));
    composeToFile(w, ["logs", "--no-color"], path.join(art, "compose.log"));
    // Only this run's compose project, with its named volumes. Other projects are untouched.
    if (composeToFile(w, ["down", "-v", "--remove-orphans", "--rmi", "local"], cleanupLog, true) !== 0) {
      failed("Docker Compose cleanup failed");
    }
    const leftovers = docker(w, ["ps", "-a", "--filter", `label=com.docker.compose.project=${w.project}`, "--format", "{{.Names}}"]);
    if (leftovers.status !== 0) failed(`Cannot check remaining containers: ${leftovers.stderr.trim()}`);
    for (const name of leftovers.stdout.split("\n").filter(Boolean)) failed(`Remaining container: ${name}`);
    const volumes = docker(w, ["volume", "ls", "--filter", `label=com.docker.compose.project=${w.project}`, "--format", "{{.Name}}"]);
    if (volumes.status !== 0) failed(`Cannot check remaining volumes: ${volumes.stderr.trim()}`);
    for (const name of volumes.stdout.split("\n").filter(Boolean)) failed(`Remaining volume: ${name}`);
  } else if (existsSync(dir)) failed(`Cannot clean up ${dir}: run.env is missing`);
  if (!complete) {
    teeAppend(cleanupLog, `Cleanup incomplete; state kept at ${dir}. Retry with WEB_RUN_ID=${runId} ${shellQuote(["node", path.join(SCRIPT_DIR, "verify-everr.ts"), "web-cleanup"])}.`);
    return 1;
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
  "web-key-save": cmdWebKeySave,
  "web-key": cmdWebKey,
  "web-onboard": cmdWebOnboard,
  "web-apply": cmdWebApply,
  "web-net": cmdWebNet,
  "web-report": cmdWebReport,
  "web-collector-restart": cmdWebCollectorRestart,
  "web-sdk-page": cmdWebSdkPage,
  "web-record": cmdWebRecord,
  "web-cleanup": cmdWebCleanup,
};
