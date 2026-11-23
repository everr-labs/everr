#!/usr/bin/env node
// verify-collector: build the Everr collector distribution from this checkout, run it against a
// throwaway ClickHouse with the repo's schema and a stub key verifier, drive its public listeners,
// and tear it all down. Run directly (`./verify-collector.ts ...` or `node verify-collector.ts ...`).
import { spawn } from "node:child_process";
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import {
  type Dirent,
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import { connect } from "node:http2";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ClickHouseSeed } from "../../../../packages/app/src/db/clickhouse-sql.ts";
import {
  REPO,
  SCRATCH_ROOT,
  STATE_DIR,
  type RunId,
  basicAuth,
  defaultRunId,
  die,
  freePort,
  isAlive,
  claimScratch,
  listDir,
  lockLifecycle,
  parseRunId,
  portOf,
  portPids,
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
} from "../../verify-shared/common.ts";

const USAGE = `# verify-collector: run the Everr collector distribution built from this checkout against a
# throwaway ClickHouse (repo schema) and a stub key verifier, drive it, and capture proof.
#
#   verify-collector launch [RUN_ID] [--profile cloud|app|deploy]   build, start, wait until ingest works
#   verify-collector doctor                       read-only: is this run worth driving?
#   verify-collector env                          export lines (origins, log paths, evidence dir)
#   verify-collector keys                         the stub's keys: name, tenant, retention, scope, policy
#   verify-collector key <name>                   print one key (secret, other, public, apply-only)
#   verify-collector otlp <label> <logs|traces|metrics> [--key N | --auth V | --no-auth] [--origin O] [--marker M] [--body F]
#   verify-collector grpc <label> [--key N | --no-auth] [--marker M]   OTLP/gRPC logs export
#   verify-collector webhook <label> <event> <payload.json> [--tenant T | --no-tenant] [--bad-signature] [--keep-times]   payload path from the repo root
#   verify-collector http <label> <METHOD> <URL> [-H 'K: V']... [--data-file F]
#   verify-collector ch <label> [--param k=v]... (<SQL> | --file F)      read ClickHouse as default, db app
#   verify-collector ch-until <label> <text> [--param k=v]... (<SQL> | --file F)   retry until stdout has text
#   verify-collector restart                      SIGTERM the collector, wait for exit, start it again
#   verify-collector cleanup                      stop everything this run started, KEEP evidence
#
# State: $REPO/.verify-everr/current-collector names the current run (RUN_ID env overrides).
# Scratch (deleted by cleanup):  \${EVERR_VERIFY_SCRATCH:-/tmp/verify-everr}/collector-<RUN_ID>/
# Evidence (never deleted):      $REPO/.verify-everr/artifacts/collector-<RUN_ID>/`;

const SELF = fileURLToPath(import.meta.url);
const CURRENT = path.join(STATE_DIR, "current-collector");
const COMPOSE_FILE = path.join(REPO, "scripts/dev/compose.yaml");
const SCHEMA_DIR = path.join(REPO, "packages/app/clickhouse");
const STATEMENTS_TS = path.join(REPO, "packages/app/src/db/clickhouse-statements.ts");
const ORIGIN_POLICY_TS = path.join(REPO, "packages/app/src/lib/public-ingest-keys.ts");
const COLLECTOR_SRC = ["receiver", "extension", "processor", "connector", "exporter", "internal", "semconv", "config"];
// Same throwaway password process-compose.yaml uses for every dev ClickHouse user.
const CH_PASSWORD = "dev";
const FORGED_TENANT = "forged-by-client";

const runDir = (id: string) => path.join(SCRATCH_ROOT, `collector-${id}`);
const artDir = (id: string) => path.join(STATE_DIR, "artifacts", `collector-${id}`);
// Compose projects are machine-wide, so the name carries the checkout: the same run id in two
// checkouts must not address (and `down -v`) one project.
const CHECKOUT = createHash("sha256").update(REPO).digest("hex").slice(0, 8);
const composeProject = (id: string) => `verify-everr-collector-${CHECKOUT}-${id}`;

type Target = "cloud" | "self-hosted";
type ProfileName = "cloud" | "app" | "deploy";

type Run = {
  id: RunId;
  profile: ProfileName;
  dir: string;
  art: string;
  project: string;
  clickhouse: string;
  verify: string;
  otlpHttp: string;
  otlpGrpc: string;
  github: string;
  health: string;
  verifySecret: string;
  webhookSecret: string;
  collectorPid: number;
  collectorStarted: string;
  stubPid: number;
  stubStarted: string;
};

type Key = {
  key: string;
  keyId: string;
  tenant: string;
  logsDays: number;
  tracesDays: number;
  metricsDays: number;
  scopes: string[];
  allowedOrigins?: string[];
};

type Profile = {
  target: Target;
  /** The config the binary runs, unmodified, relative to the repo. */
  config: string;
  /** scripts/dev/compose.yaml service, so the ClickHouse image and settings match development. */
  clickhouse: "clickhouse-cloud" | "clickhouse-app";
  /** Whether the real verify-key endpoint returns tenantId for this deployment. */
  tenant: boolean;
  github: boolean;
  health: boolean;
  usage: boolean;
  env: (r: Run) => Record<string, string>;
  /** A second config merged over `config`, for listeners it hardcodes to fixed public ports. The
   * distribution has only the env and file confmap providers, so `--set` (a yaml: URI) is not available. */
  overlay?: (r: Run) => string;
};

const devEnv = (r: Run): Record<string, string> => ({
  CLICKHOUSE_URL: r.clickhouse,
  CLICKHOUSE_USERNAME: "collector_rw",
  CLICKHOUSE_PASSWORD: CH_PASSWORD,
  CLICKHOUSE_DATABASE: "otel",
  INGEST_VERIFY_URL: `${r.verify}/api/internal/verify-key`,
  INGEST_VERIFY_SHARED_SECRET: r.verifySecret,
  PORT: portOf(r.otlpHttp),
  OTLP_GRPC_PORT: portOf(r.otlpGrpc),
  GITHUB_PORT: portOf(r.github),
  GITHUB_APP_WEBHOOK_SECRET: r.webhookSecret,
  // The receiver needs an App id and a parseable key at startup; only workflow_run events use them (GitHub API).
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: readFileSync(path.join(r.dir, "github-app.pem"), "utf8"),
  EVERR_QUEUE_DIRECTORY: path.join(r.dir, "queue"),
});

const PROFILES: Record<ProfileName, Profile> = {
  cloud: {
    target: "cloud",
    config: "scripts/dev/collector-cloud.yaml",
    clickhouse: "clickhouse-cloud",
    tenant: true,
    github: true,
    health: false,
    usage: true,
    env: devEnv,
  },
  app: {
    target: "self-hosted",
    config: "scripts/dev/collector-app.yaml",
    clickhouse: "clickhouse-app",
    // The development App returns the organization as tenant (storage.telemetryTenantId under import.meta.env.DEV).
    tenant: true,
    github: true,
    health: false,
    usage: false,
    env: devEnv,
  },
  deploy: {
    target: "self-hosted",
    config: "deploy/collector.yaml",
    clickhouse: "clickhouse-app",
    // A production self-hosted App omits tenantId (deploy/README.md: no tenant stamp).
    tenant: false,
    github: false,
    health: true,
    usage: false,
    env: (r) => ({
      EVERR_VERIFY_ENDPOINT: `${r.verify}/api/internal/verify-key`,
      INGEST_VERIFY_SHARED_SECRET: r.verifySecret,
      CLICKHOUSE_ENDPOINT: r.clickhouse,
      COLLECTOR_RW_PASSWORD: CH_PASSWORD,
      EVERR_QUEUE_DIRECTORY: path.join(r.dir, "queue"),
    }),
    overlay: (r) =>
      [
        "extensions:",
        "  health_check:",
        `    endpoint: 127.0.0.1:${portOf(r.health)}`,
        "receivers:",
        "  otlp/public:",
        "    protocols:",
        "      http:",
        `        endpoint: 127.0.0.1:${portOf(r.otlpHttp)}`,
        "      grpc:",
        `        endpoint: 127.0.0.1:${portOf(r.otlpGrpc)}`,
        "",
      ].join("\n"),
  },
};

const binary = (t: Target) => path.join(REPO, "collector/build", t, "everr-collector");
const collectorLog = (r: Run) => path.join(r.dir, "collector.log");
const verifyLog = (r: Run) => path.join(r.dir, "verify.log");

function saveRun(r: Run): void {
  writeFileSync(path.join(r.dir, "run.json"), `${JSON.stringify(r, null, 2)}\n`);
}

function loadRun(): Run {
  const id = process.env.RUN_ID || readPointer(CURRENT);
  if (!id) die("no current run; run 'verify-collector launch' first");
  const file = path.join(runDir(parseRunId(id)), "run.json");
  const text = readText(file);
  if (text === undefined) die(`run ${id} has no state at ${file} (already cleaned up?)`);
  return JSON.parse(text) as Run;
}

const loadKeys = (r: Run): Record<string, Key> => JSON.parse(readFileSync(path.join(r.dir, "keys.json"), "utf8"));

function keysFor(id: string): Record<string, Key> {
  const key = () => `ek_${randomBytes(24).toString("base64url")}`;
  const tenantA = `verify-${id}-a`;
  return {
    secret: { key: key(), keyId: "key-secret", tenant: tenantA, logsDays: 7, tracesDays: 14, metricsDays: 30, scopes: ["ingest"] },
    other: { key: key(), keyId: "key-other", tenant: `verify-${id}-b`, logsDays: 90, tracesDays: 90, metricsDays: 90, scopes: ["ingest"] },
    public: {
      key: key(),
      keyId: "key-public",
      tenant: tenantA,
      logsDays: 7,
      tracesDays: 14,
      metricsDays: 30,
      scopes: ["ingest"],
      allowedOrigins: ["https://allowed.verify.test"],
    },
    "apply-only": { key: key(), keyId: "key-apply-only", tenant: tenantA, logsDays: 7, tracesDays: 14, metricsDays: 30, scopes: ["apply"] },
  };
}

type VerifyResult = { status: number; body?: Record<string, unknown>; name: string };
type OriginPolicy = (metadata: unknown, origin: string | null) => boolean;

/** Mirrors packages/app/src/routes/api/internal/verify-key.ts. The origin decision is the application's own originPolicyAllows. */
function verifyDecision(keys: Record<string, Key>, tenant: boolean, secret: string, sent: string | undefined, raw: string, originAllowed: OriginPolicy): VerifyResult {
  if (sent !== secret) return { status: 403, name: "-" };
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { status: 400, name: "-" };
  }
  const b = (typeof body === "object" && body !== null ? body : {}) as { key?: unknown; origin?: unknown };
  if (typeof b.key !== "string") return { status: 400, name: "-" };
  const found = Object.entries(keys).find(([, k]) => k.key === b.key);
  if (!found) return { status: 401, name: "unknown" };
  const [name, k] = found;
  if (!k.scopes.includes("ingest")) return { status: 403, name };
  const metadata = k.allowedOrigins ? { public: true, allowedOrigins: k.allowedOrigins } : undefined;
  if (!originAllowed(metadata, typeof b.origin === "string" ? b.origin : null)) return { status: 403, name };
  return {
    status: 200,
    name,
    body: { ...(tenant ? { tenantId: k.tenant } : {}), keyId: k.keyId, tracesDays: k.tracesDays, logsDays: k.logsDays, metricsDays: k.metricsDays },
  };
}

async function cmdVerifyStub(dir: string): Promise<void> {
  const r = JSON.parse(readFileSync(path.join(dir, "run.json"), "utf8")) as Run;
  const { originPolicyAllows } = (await import(pathToFileURL(ORIGIN_POLICY_TS).href)) as { originPolicyAllows: OriginPolicy };
  const keys = loadKeys(r);
  const tenant = PROFILES[r.profile].tenant;
  const server = http.createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => (raw += c));
    req.on("end", () => {
      const sent = req.headers["x-internal-secret"];
      const d = req.url === "/api/internal/verify-key" && req.method === "POST"
        ? verifyDecision(keys, tenant, r.verifySecret, Array.isArray(sent) ? sent[0] : sent, raw, originPolicyAllows)
        : { status: 404, name: "-" };
      let origin: string | undefined;
      try {
        origin = (JSON.parse(raw) as { origin?: string }).origin;
      } catch {}
      appendFileSync(verifyLog(r), `${JSON.stringify({ at: new Date().toISOString(), key: d.name, origin: origin ?? null, status: d.status, body: d.body ?? null })}\n`);
      if (d.body) {
        res.writeHead(d.status, { "content-type": "application/json" });
        res.end(JSON.stringify(d.body));
      } else {
        res.writeHead(d.status);
        res.end();
      }
    });
  });
  server.listen(Number(portOf(r.verify)), "127.0.0.1");
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

const compose = (r: Run, args: string[]) =>
  run("docker", ["compose", "-p", r.project, "-f", COMPOSE_FILE, ...args], { env: { ...process.env, DEV_ROOT: REPO } });

const chAuth = { Authorization: basicAuth("default", CH_PASSWORD) };

/** SQL over ClickHouse HTTP as `default`. Drive reads pass db "app"; launch runs before that database exists. */
async function chPost(r: Run, sql: string, params: Record<string, string> = {}, db?: string): Promise<{ ok: boolean; status: number; text: string }> {
  const url = new URL(`${r.clickhouse}/`);
  if (db) url.searchParams.set("database", db);
  url.searchParams.set("default_format", "JSONEachRow");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(`param_${k}`, v);
  try {
    const res = await fetch(url, { method: "POST", body: sql, headers: chAuth, signal: AbortSignal.timeout(120000) });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (e) {
    return { ok: false, status: 0, text: e instanceof Error ? e.message : String(e) };
  }
}

/** Apply packages/app/clickhouse the way the app's startup runner does: tag filter, file order, its own splitter, bound params. */
async function applySchema(r: Run, target: Target): Promise<void> {
  const { sqlStatements } = (await import(pathToFileURL(STATEMENTS_TS).href)) as { sqlStatements: (sql: string) => string[] };
  const params: Record<string, string> = {
    collector_rw_password: CH_PASSWORD,
    app_ro_password: CH_PASSWORD,
    app_admin_password: CH_PASSWORD,
    sql_api_username: "sql_api",
    sql_api_password: CH_PASSWORD,
  };
  const files = readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => {
      const tag = /^\d+-(cloud|self-hosted)-/.exec(f)?.[1];
      return tag === undefined || tag === target;
    })
    .sort();
  const out = path.join(r.art, "schema.txt");
  writeFileSync(out, `target: ${target}\n`);
  for (const f of files) {
    const statements = sqlStatements(readFileSync(path.join(SCHEMA_DIR, f), "utf8"));
    for (const [i, statement] of statements.entries()) {
      const bound = Object.fromEntries([...statement.matchAll(/\{(\w+):\w+\}/g)].map(([, name]) => [name, params[name] ?? die(`${f} needs parameter ${name}`)]));
      const res = await chPost(r, statement, bound);
      if (!res.ok) {
        teeAppend(out, `FAILED ${f} statement ${i}: HTTP ${res.status} ${res.text.trim()}`);
        die(`schema ${f} statement ${i} failed; see ${out}; run 'verify-collector cleanup'`);
      }
    }
    const seedFile = path.join(SCHEMA_DIR, f.replace(/\.sql$/, ".seed.ts"));
    const seeded = existsSync(seedFile);
    if (seeded) {
      // A string parameter with the escapes @clickhouse/client gives it.
      const param = (value: string | number) =>
        String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "\\r");
      const sql = async (query: string, bound: Record<string, string | number> = {}): Promise<string> => {
        const res = await chPost(r, query, Object.fromEntries(Object.entries(bound).map(([name, value]) => [name, param(value)])));
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.text.trim()}`);
        return res.text;
      };
      try {
        const { default: seed } = (await import(pathToFileURL(seedFile).href)) as { default: ClickHouseSeed };
        await seed({
          query: async (query, bound) => (await sql(query, bound)).split("\n").filter(Boolean).map((row) => JSON.parse(row)),
          command: async (query, bound) => void (await sql(query, bound)),
        });
      } catch (e) {
        teeAppend(out, `FAILED ${f} seed: ${e instanceof Error ? e.message : String(e)}`);
        die(`schema ${f} seed failed; see ${out}; run 'verify-collector cleanup'`);
      }
    }
    teeAppend(out, `applied ${f} (${statements.length} statements${seeded ? ", seed" : ""})`);
  }
}

async function waitFor(what: string, seconds: number, ok: () => Promise<boolean>, alive?: () => boolean, log?: string): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    if (await ok()) return;
    if (alive && !alive()) die(`${what}: process exited${log ? `; last lines of ${log}:\n${(readText(log) ?? "").trimEnd().split("\n").slice(-5).join("\n")}` : ""}`);
    if (Date.now() >= deadline) die(`${what}: not ready within ${seconds}s`);
    await sleep(500);
  }
}

/** `ps` start time of a pid, "" when it is gone. With the pid it names one process, so a reused pid is never taken for ours. */
const startedAt = (pid: number): string =>
  pid > 0 ? run("ps", ["-o", "lstart=", "-p", String(pid)], { env: { ...process.env, LC_ALL: "C" } }).stdout.trim() : "";

const ours = (pid: number, started: string): boolean => started !== "" && startedAt(pid) === started;

function startProcess(r: Run, file: string, args: string[], env: Record<string, string>, log: string): number {
  const fd = openSync(log, "a");
  const child = spawn(file, args, { detached: true, stdio: ["ignore", fd, fd], env, cwd: r.dir });
  closeSync(fd);
  child.unref();
  if (child.pid === undefined) die(`could not start ${file}`);
  return child.pid;
}

function startCollector(r: Run): number {
  const p = PROFILES[r.profile];
  const args = ["--config", path.join(REPO, p.config)];
  if (p.overlay) {
    const overlay = path.join(r.dir, "listeners.overlay.yaml");
    writeFileSync(overlay, p.overlay(r));
    copyFileSync(overlay, path.join(r.art, "listeners.overlay.yaml"));
    args.push("--config", overlay);
  }
  writeFileSync(path.join(r.art, "collector.command.txt"), `${shellQuote([path.relative(REPO, binary(p.target)), ...args])}\n`);
  // A clean env: only the config's variables, so no OTEL_* or developer setting leaks in.
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: r.dir, ...p.env(r) };
  return startProcess(r, binary(p.target), args, env, collectorLog(r));
}

async function collectorReady(r: Run): Promise<boolean> {
  const p = PROFILES[r.profile];
  const pid = String(r.collectorPid);
  const owns = (origin: string) => portPids(portOf(origin)).split(" ").includes(pid);
  if (!owns(r.otlpHttp) || !owns(r.otlpGrpc)) return false;
  // process-compose.yaml's own readiness probe: unauthenticated OTLP is 401 and an unsigned webhook GET is 400.
  if ((await send("POST", `${r.otlpHttp}/v1/logs`, { "content-type": "application/json" }, "{}")).status !== 401) return false;
  if (p.github && (await send("GET", `${r.github}/webhook/github`, {})).status !== 400) return false;
  if (p.health && (await send("GET", `${r.health}/`, {})).status !== 200) return false;
  return true;
}

async function cmdLaunch(args: string[]): Promise<number> {
  lockLifecycle(CURRENT);
  const live = readPointer(CURRENT);
  if (live && existsSync(path.join(runDir(live), "run.json"))) die(`run ${live} is still live; run 'verify-collector cleanup' first`);
  const profileArg = flag(args, "--profile") ?? "cloud";
  if (!(profileArg in PROFILES)) die(`unknown profile '${profileArg}' (cloud, app, deploy)`);
  const profile = profileArg as ProfileName;
  const p = PROFILES[profile];
  const id = parseRunId(positional(args)[0] || defaultRunId());
  // Docker Compose project names allow only lowercase letters, digits, '-' and '_'.
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) die(`run id '${id}' must match [a-z0-9][a-z0-9_-]* (it names a Compose project)`);
  if (run("docker", ["info", "--format", "{{.ServerVersion}}"]).status !== 0) die("docker daemon not reachable");

  const dir = runDir(id);
  const art = artDir(id);
  claimScratch(dir);
  mkdirSync(path.join(dir, "queue"));
  mkdirSync(art, { recursive: true });
  const port = async () => `http://127.0.0.1:${await freePort()}`;
  const r: Run = {
    id,
    profile,
    dir,
    art,
    project: composeProject(id),
    clickhouse: "",
    verify: await port(),
    otlpHttp: await port(),
    otlpGrpc: await port(),
    github: p.github ? await port() : "",
    health: p.health ? await port() : "",
    verifySecret: randomBytes(24).toString("hex"),
    webhookSecret: randomBytes(24).toString("hex"),
    collectorPid: 0,
    collectorStarted: "",
    stubPid: 0,
    stubStarted: "",
  };
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  writeFileSync(path.join(dir, "github-app.pem"), privateKey.export({ type: "pkcs1", format: "pem" }), { mode: 0o600 });
  writeFileSync(path.join(dir, "keys.json"), JSON.stringify(keysFor(id), null, 2), { mode: 0o600 });
  saveRun(r);
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(CURRENT, `${id}\n`);
  console.log(`launching collector run ${id} profile=${profile} (scratch ${dir}, evidence ${art})`);

  const build = runToFiles("make", ["-C", "collector", "build", `EVERR_BUILD_TARGET=${p.target}`], { stdout: path.join(art, "build.log") }, { cwd: REPO });
  if (build !== 0) die(`collector build failed (exit ${build}); see ${art}/build.log; run 'verify-collector cleanup'`);
  copyFileSync(path.join(REPO, p.config), path.join(art, "collector-config.yaml"));
  writeFileSync(
    path.join(art, "run.txt"),
    [
      `run_id: ${id}`,
      `profile: ${profile} (target ${p.target}, config ${p.config}, stub tenantId ${p.tenant ? "returned" : "omitted"})`,
      `git_head: ${run("git", ["-C", REPO, "rev-parse", "HEAD"]).stdout.trim()}`,
      `git_branch: ${run("git", ["-C", REPO, "rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim()}`,
      `git_dirty_collector: ${run("git", ["-C", REPO, "status", "--porcelain", "--", "collector", p.config]).stdout.trim().split("\n").filter(Boolean).length} paths`,
      `binary: ${path.relative(REPO, binary(p.target))} built ${stamp(binary(p.target))}`,
      `launched_at: ${stamp()}`,
      "",
    ].join("\n"),
  );

  const up = compose(r, ["up", "-d", "--wait", p.clickhouse]);
  writeFileSync(path.join(art, "compose-up.txt"), up.stdout + up.stderr);
  if (up.status !== 0) die(`docker compose up failed; see ${art}/compose-up.txt; run 'verify-collector cleanup'`);
  const published = compose(r, ["port", p.clickhouse, "8123"]).stdout.trim();
  if (!/^127\.0\.0\.1:\d+$/.test(published)) die(`unexpected ClickHouse port '${published}'; run 'verify-collector cleanup'`);
  r.clickhouse = `http://${published}`;
  saveRun(r);
  await waitFor("ClickHouse", 90, async () => (await chPost(r, "SELECT 1")).text.trim() === '{"1":1}');
  await applySchema(r, p.target);

  r.stubPid = startProcess(r, process.execPath, [SELF, "_verify-stub", dir], { PATH: process.env.PATH ?? "" }, path.join(dir, "verify-stub.log"));
  r.stubStarted = startedAt(r.stubPid);
  saveRun(r);
  await waitFor("stub verifier", 15, async () => (await send("POST", `${r.verify}/api/internal/verify-key`, {}, "{}")).status === 403, () => isAlive(r.stubPid));

  r.collectorPid = startCollector(r);
  r.collectorStarted = startedAt(r.collectorPid);
  saveRun(r);
  await waitFor("collector", 60, () => collectorReady(r), () => isAlive(r.collectorPid), collectorLog(r));

  const keys = loadKeys(r);
  writeFileSync(
    path.join(art, "keys.txt"),
    Object.entries(keys).map(([n, k]) => `${n}: ${keyLine(k, p)}`).join("\n") + "\n",
  );
  const ready = `COLLECTOR READY run=${id} profile=${profile} otlp_http=${r.otlpHttp} otlp_grpc=${r.otlpGrpc}${r.github ? ` github=${r.github}/webhook/github` : ""}${r.health ? ` health=${r.health}` : ""} clickhouse=${r.clickhouse} verify=${r.verify}`;
  teeAppend(path.join(art, "launch.txt"), ready);
  return 0;
}

const keyLine = (k: Key, p: Profile) =>
  `tenant=${p.tenant ? k.tenant : "(omitted)"} key_id=${k.keyId} logs=${k.logsDays}d traces=${k.tracesDays}d metrics=${k.metricsDays}d scopes=${k.scopes.join(",")}${k.allowedOrigins ? ` public origins=${k.allowedOrigins.join(",")}` : " secret"}`;

function newestSource(after: number): string | undefined {
  const walk = (dir: string): string | undefined => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        const hit = walk(p);
        if (hit) return hit;
      } else if (e.isFile() && statSync(p).mtimeMs > after) return p;
    }
    return undefined;
  };
  for (const d of COLLECTOR_SRC) {
    const hit = walk(path.join(REPO, "collector", d));
    if (hit) return hit;
  }
  return undefined;
}

async function cmdDoctor(): Promise<number> {
  const r = loadRun();
  const p = PROFILES[r.profile];
  let ok = true;
  const check = (label: string, pass: boolean) => {
    console.log(`${pass ? "ok  " : "FAIL"} ${label}`);
    if (!pass) ok = false;
  };
  console.log(`run: ${r.id} profile=${r.profile} head=${run("git", ["-C", REPO, "rev-parse", "--short", "HEAD"]).stdout.trim()}`);
  const bin = binary(p.target);
  check(`binary ${path.relative(REPO, bin)} exists`, existsSync(bin));
  const stale = existsSync(bin) ? newestSource(statSync(bin).mtimeMs) : undefined;
  if (stale) console.log(`WARN ${path.relative(REPO, stale)} is newer than the binary; cleanup and launch again to rebuild`);
  check(`${p.config} unchanged since launch`, readText(path.join(REPO, p.config)) === readText(path.join(r.art, "collector-config.yaml")));
  const container = compose(r, ["ps", "-q", p.clickhouse]).stdout.trim();
  check(`container ${r.project}-${p.clickhouse}-1 running`, container !== "" && run("docker", ["inspect", "-f", "{{.State.Running}}", container]).stdout.trim() === "true");
  const tables = await chPost(r, "SELECT count() AS n FROM system.tables WHERE database = 'app' AND name IN ('logs', 'traces', 'metrics_sum')", {}, "app");
  check("ClickHouse answers and app.logs/traces/metrics_sum exist", tables.text.trim() === '{"n":"3"}' || tables.text.trim() === '{"n":3}');
  const owned = (origin: string, pid: number) => portPids(portOf(origin)).split(" ").includes(String(pid));
  check(`collector pid ${r.collectorPid} alive`, isAlive(r.collectorPid));
  for (const [name, origin] of [["otlp http", r.otlpHttp], ["otlp grpc", r.otlpGrpc], ["github", r.github], ["health", r.health]]) {
    if (origin) check(`${name} port ${portOf(origin)} owned by collector`, owned(origin, r.collectorPid));
  }
  check(`stub verifier pid ${r.stubPid} owns port ${portOf(r.verify)}`, owned(r.verify, r.stubPid));
  check("stub verifier rejects a request without the shared secret (403)", (await send("POST", `${r.verify}/api/internal/verify-key`, {}, "{}")).status === 403);
  check("OTLP/HTTP without a key is 401", (await send("POST", `${r.otlpHttp}/v1/logs`, { "content-type": "application/json" }, "{}")).status === 401);
  check("OTLP/gRPC without a key is grpc-status 16 (UNAUTHENTICATED)", (await grpcExport(r.otlpGrpc, {}, Buffer.alloc(0))).status === "16");
  if (r.github) check("GitHub listener answers an unsigned GET with 400", (await send("GET", `${r.github}/webhook/github`, {})).status === 400);
  if (r.health) check("health_check answers 200", (await send("GET", `${r.health}/`, {})).status === 200);
  const log = readText(collectorLog(r)) ?? "";
  check("collector log has no schema detection failure", !/schema detection failed/i.test(log));
  const errors = log.split("\n").filter((l) => /\terror\t/.test(l));
  console.log(`info collector log: ${errors.length} error lines${errors.length ? ` (last: ${errors.at(-1)?.slice(0, 200)})` : ""}`);
  console.log(ok ? "COLLECTOR DOCTOR OK" : "COLLECTOR DOCTOR FAILED");
  return ok ? 0 : 1;
}

type Sent = { status: number; headers: string; body: string; error?: string };

async function send(method: string, url: string, headers: Record<string, string>, body?: string | Buffer): Promise<Sent> {
  try {
    const payload = typeof body === "string" || body === undefined ? body : new Uint8Array(body);
    const res = await fetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(30000) });
    const lines = [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n");
    return { status: res.status, headers: `${lines}\n`, body: await res.text() };
  } catch (e) {
    const err = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
    return { status: 0, headers: "", body: "", error: err };
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? required(args[i + 1], `${name} value`) : undefined;
}

function flags(args: string[], name: string): string[] {
  return args.flatMap((a, i) => (a === name ? [required(args[i + 1], `${name} value`)] : []));
}

const VALUE_FLAGS = new Set(["--key", "--auth", "--origin", "--marker", "--body", "--tenant", "--profile", "-H", "--data-file", "--param", "--file"]);

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (VALUE_FLAGS.has(args[i])) i++;
    else if (!args[i].startsWith("--")) out.push(args[i]);
  }
  return out;
}

function record(r: Run, kind: string, label: string, files: Record<string, string>): string {
  const out = path.join(r.art, kind, label);
  if (existsSync(out)) die(`evidence ${out} exists; labels must be unique within a run`);
  mkdirSync(out, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(out, name), text);
  writeFileSync(path.join(out, "at.txt"), `${stamp()}\n`);
  return out;
}

/** The Authorization header for a drive call, and how evidence names it (never the key itself). */
function authFor(r: Run, args: string[]): { header?: string; shown: string } {
  if (args.includes("--no-auth")) return { shown: "(none)" };
  const raw = flag(args, "--auth");
  if (raw !== undefined) return { header: raw, shown: JSON.stringify(raw) };
  const name = flag(args, "--key") ?? "secret";
  const k = loadKeys(r)[name] ?? die(`no key '${name}' (see 'verify-collector keys')`);
  return { header: `Bearer ${k.key}`, shown: `Bearer <${name} key>` };
}

const kv = (key: string, value: string) => ({ key, value: { stringValue: value } });

/** One record per signal. The client forges tenant and retention on the resource and the record; the collector must replace or drop them. */
function otlpBody(signal: string, marker: string): unknown {
  const now = BigInt(Date.now()) * 1000000n;
  const ns = (v: bigint) => v.toString();
  const resource = { attributes: [kv("service.name", "verify-collector"), kv("everr.tenant.id", FORGED_TENANT), kv("everr.retention.days", "3650"), kv("everr.verify.marker", marker)] };
  const attributes = [kv("everr.tenant.id", FORGED_TENANT), kv("everr.retention.days", "3650"), kv("everr.verify.marker", marker)];
  const scope = { name: "verify-collector" };
  if (signal === "logs") {
    return { resourceLogs: [{ resource, scopeLogs: [{ scope, logRecords: [{ timeUnixNano: ns(now), observedTimeUnixNano: ns(now), severityNumber: 9, severityText: "INFO", body: { stringValue: marker }, attributes }] }] }] };
  }
  if (signal === "traces") {
    const span = { traceId: randomBytes(16).toString("hex"), spanId: randomBytes(8).toString("hex"), name: marker, kind: 2, startTimeUnixNano: ns(now - 5000000n), endTimeUnixNano: ns(now), attributes, status: { code: 1 } };
    return { resourceSpans: [{ resource, scopeSpans: [{ scope, spans: [span] }] }] };
  }
  if (signal === "metrics") {
    const point = { startTimeUnixNano: ns(now - 1000000000n), timeUnixNano: ns(now), asInt: "1", attributes };
    return {
      resourceMetrics: [{
        resource,
        scopeMetrics: [{
          scope,
          metrics: [
            { name: "verify.collector.requests", unit: "1", sum: { aggregationTemporality: 2, isMonotonic: true, dataPoints: [point] } },
            { name: "everr.verify.forged", unit: "1", gauge: { dataPoints: [{ timeUnixNano: ns(now), asInt: "1", attributes }] } },
          ],
        }],
      }],
    };
  }
  return die(`signal must be logs, traces or metrics (got '${signal}')`);
}

async function cmdOtlp(r: Run, args: string[]): Promise<number> {
  const [label, signal] = positional(args);
  required(label, "label");
  const marker = flag(args, "--marker") ?? `${r.id}-${label}`;
  const bodyFile = flag(args, "--body");
  const body = bodyFile ? readFileSync(bodyFile, "utf8") : JSON.stringify(otlpBody(required(signal, "signal"), marker), null, 2);
  const auth = authFor(r, args);
  const origin = flag(args, "--origin");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth.header !== undefined) headers.authorization = auth.header;
  if (origin) headers.origin = origin;
  const url = `${r.otlpHttp}/v1/${signal}`;
  const res = await send("POST", url, headers, body);
  const command = `POST ${url}\nauthorization: ${auth.shown}${origin ? `\norigin: ${origin}` : ""}\ncontent-type: application/json\nmarker: ${marker}\n`;
  const out = record(r, "http", label, { "command.txt": command, "request.json": body, status: `${res.status}\n`, headers: res.headers, body: res.body + (res.error ? `\n${res.error}\n` : "") });
  console.log(`${command}--- HTTP ${res.status} ${res.body.slice(0, 300)}${res.error ?? ""}\n(evidence: ${out})`);
  return res.status === 0 ? 1 : 0;
}

// Minimal protobuf for ExportLogsServiceRequest: varints, length-delimited fields and fixed64 times.
const varint = (n: number | bigint): Buffer => {
  const bytes: number[] = [];
  let v = BigInt(n);
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    bytes.push(b);
  } while (v > 0n);
  return Buffer.from(bytes);
};
const field = (n: number, payload: Buffer | string): Buffer => {
  const data = typeof payload === "string" ? Buffer.from(payload) : payload;
  return Buffer.concat([varint((n << 3) | 2), varint(data.length), data]);
};
const fixed64 = (n: number, v: bigint): Buffer => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return Buffer.concat([varint((n << 3) | 1), b]);
};

/** KeyValue{key, AnyValue{string_value}} as field n of the enclosing message. */
const pbKvAt = (n: number, key: string, value: string) => field(n, Buffer.concat([field(1, key), field(2, field(1, value))]));

function logsProto(marker: string): Buffer {
  const now = BigInt(Date.now()) * 1000000n;
  const attrs = (n: number) => Buffer.concat([pbKvAt(n, "everr.tenant.id", FORGED_TENANT), pbKvAt(n, "everr.retention.days", "3650"), pbKvAt(n, "everr.verify.marker", marker)]);
  const resource = Buffer.concat([pbKvAt(1, "service.name", "verify-collector"), attrs(1)]);
  const record = Buffer.concat([fixed64(1, now), varint((2 << 3) | 0), varint(9), field(3, "INFO"), field(5, field(1, marker)), attrs(6), fixed64(11, now)]);
  const scopeLogs = Buffer.concat([field(1, field(1, "verify-collector")), field(2, record)]);
  return field(1, Buffer.concat([field(1, resource), field(2, scopeLogs)]));
}

function grpcExport(origin: string, headers: Record<string, string>, message: Buffer): Promise<{ status: string; message: string; error?: string }> {
  return new Promise((resolve) => {
    const client = connect(origin);
    let status = "";
    let msg = "";
    const done = (error?: string) => {
      client.destroy();
      resolve({ status, message: msg, error });
    };
    client.on("error", (e) => done(e.message));
    const req = client.request({ ":method": "POST", ":path": "/opentelemetry.proto.collector.logs.v1.LogsService/Export", "content-type": "application/grpc", te: "trailers", ...headers });
    const onHeaders = (h: Record<string, unknown>) => {
      if (h["grpc-status"] !== undefined) status = String(h["grpc-status"]);
      if (h["grpc-message"] !== undefined) msg = decodeURIComponent(String(h["grpc-message"]));
    };
    req.on("response", onHeaders);
    req.on("trailers", onHeaders);
    req.on("error", (e) => done(e.message));
    req.on("end", () => done());
    req.setTimeout(10000, () => done("timeout"));
    req.resume();
    const frame = Buffer.alloc(5);
    frame.writeUInt32BE(message.length, 1);
    req.end(Buffer.concat([frame, message]));
  });
}

async function cmdGrpc(r: Run, args: string[]): Promise<number> {
  const label = required(positional(args)[0], "label");
  const marker = flag(args, "--marker") ?? `${r.id}-${label}`;
  const auth = authFor(r, args);
  const headers: Record<string, string> = auth.header !== undefined ? { authorization: auth.header } : {};
  const res = await grpcExport(r.otlpGrpc, headers, logsProto(marker));
  const command = `gRPC ${r.otlpGrpc} opentelemetry.proto.collector.logs.v1.LogsService/Export\nauthorization: ${auth.shown}\nmarker: ${marker}\n`;
  const out = record(r, "grpc", label, { "command.txt": command, "grpc-status": `${res.status}\n`, "grpc-message": `${res.message}\n${res.error ?? ""}` });
  console.log(`${command}--- grpc-status ${res.status} ${res.message}${res.error ? ` (${res.error})` : ""}\n(evidence: ${out})`);
  return res.status === "" ? 1 : 0;
}

/** Move every ISO timestamp by the same amount so the latest is now. Fixtures carry old dates, and the
 * views' retention TTL drops rows older than the retention window at insert. */
function shiftToNow(text: string, keep: boolean): string {
  const re = /"(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)"/g;
  const times = [...text.matchAll(re)].map((m) => Date.parse(m[1]));
  if (keep || times.length === 0) return text;
  const delta = Date.now() - 1000 - Math.max(...times);
  return text.replace(re, (_, t: string) => `"${new Date(Date.parse(t) + delta).toISOString().replace(/\.\d{3}Z$/, "Z")}"`);
}

async function cmdWebhook(r: Run, args: string[]): Promise<number> {
  if (!r.github) die(`profile ${r.profile} has no GitHub listener`);
  const [label, event, payload] = positional(args);
  required(label, "label");
  required(event, "event");
  const body = Buffer.from(shiftToNow(readFileSync(path.resolve(REPO, required(payload, "payload file")), "utf8"), args.includes("--keep-times")));
  const secret = args.includes("--bad-signature") ? "not-the-webhook-secret" : r.webhookSecret;
  const k = loadKeys(r).secret;
  // The headers packages/app/src/server/github-events/collector.ts adds when it replays a delivery.
  const tenant = args.includes("--no-tenant") ? undefined : flag(args, "--tenant") ?? (PROFILES[r.profile].tenant ? k.tenant : undefined);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": event,
    "x-github-delivery": randomUUID(),
    "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
    "x-everr-retention-logs-days": String(k.logsDays),
    "x-everr-retention-traces-days": String(k.tracesDays),
    "x-everr-retention-metrics-days": String(k.metricsDays),
    ...(tenant ? { "x-everr-tenant-id": tenant } : {}),
  };
  const url = `${r.github}/webhook/github`;
  const res = await send("POST", url, headers, body);
  const command = `POST ${url}\n${Object.entries(headers).map(([h, v]) => `${h}: ${v}`).join("\n")}\nsigned with: ${args.includes("--bad-signature") ? "a wrong secret" : "the run's webhook secret"}\npayload: ${payload} (${args.includes("--keep-times") ? "timestamps as written" : "timestamps shifted so the latest is now"})\n`;
  const out = record(r, "http", label, { "command.txt": command, "request.json": body.toString("utf8"), status: `${res.status}\n`, headers: res.headers, body: res.body + (res.error ? `\n${res.error}\n` : "") });
  console.log(`${command}--- HTTP ${res.status} ${res.body.slice(0, 300)}${res.error ?? ""}\n(evidence: ${out})`);
  return res.status === 0 ? 1 : 0;
}

async function cmdHttp(r: Run, args: string[]): Promise<number> {
  const [label, method, url] = positional(args);
  required(label, "label");
  required(url, "URL");
  const headers = Object.fromEntries(flags(args, "-H").map((h) => [h.slice(0, h.indexOf(":")).trim(), h.slice(h.indexOf(":") + 1).trim()]));
  const dataFile = flag(args, "--data-file");
  const res = await send(required(method, "METHOD").toUpperCase(), url, headers, dataFile ? readFileSync(dataFile) : undefined);
  const command = `${method.toUpperCase()} ${url}\n${Object.entries(headers).map(([h, v]) => `${h}: ${/^authorization$/i.test(h) ? "<redacted>" : v}`).join("\n")}\n${dataFile ? `data-file: ${dataFile}\n` : ""}`;
  const out = record(r, "http", label, { "command.txt": command, status: `${res.status}\n`, headers: res.headers, body: res.body + (res.error ? `\n${res.error}\n` : "") });
  console.log(`${command}--- HTTP ${res.status}\n${res.headers}${res.body.slice(0, 300)}${res.error ?? ""}\n(evidence: ${out})`);
  return res.status === 0 ? 1 : 0;
}

function chArgs(args: string[], skip: number): { sql: string; params: Record<string, string> } {
  const file = flag(args, "--file");
  const sql = file ? readFileSync(path.resolve(REPO, file), "utf8") : required(positional(args)[skip], "SQL or --file");
  const params = Object.fromEntries(flags(args, "--param").map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]));
  return { sql, params };
}

async function cmdCh(r: Run, args: string[]): Promise<number> {
  const label = required(positional(args)[0], "label");
  const { sql, params } = chArgs(args, 1);
  const res = await chPost(r, sql, params, "app");
  const out = record(r, "db", label, { "query.sql": `${sql}\n`, "params.json": `${JSON.stringify(params)}\n`, status: `${res.status}\n`, stdout: res.text });
  console.log(`${res.text}--- HTTP ${res.status} (evidence: ${out})`);
  return res.ok ? 0 : 1;
}

async function cmdChUntil(r: Run, args: string[]): Promise<number> {
  const [label, want] = positional(args);
  required(label, "label");
  required(want, "expected text");
  const { sql, params } = chArgs(args, 2);
  const start = Date.now();
  const deadline = start + Number(process.env.UNTIL_S || 30) * 1000;
  let tries = 0;
  let res = await chPost(r, sql, params, "app");
  for (;;) {
    tries++;
    if (res.ok && res.text.includes(want)) break;
    if (Date.now() >= deadline) break;
    await sleep(500);
    res = await chPost(r, sql, params, "app");
  }
  const found = res.ok && res.text.includes(want);
  const line = `${found ? "found" : "NOT FOUND"} '${want}' after ${tries} tries (${((Date.now() - start) / 1000).toFixed(1)}s)`;
  const out = record(r, "db", label, { "query.sql": `${sql}\n`, "params.json": `${JSON.stringify(params)}\n`, status: `${res.status}\n`, stdout: res.text, "until.txt": `${line}\n` });
  console.log(`${line}\n${res.text}(evidence: ${out})`);
  return found ? 0 : 1;
}

/** Stop a process this run started. A recorded pid that now names another process is left alone. */
async function stopPid(pid: number, started: string, graceS: number, log: string): Promise<void> {
  if (!ours(pid, started)) return;
  const begun = Date.now();
  process.kill(pid, "SIGTERM");
  while (ours(pid, started) && Date.now() - begun < graceS * 1000) await sleep(200);
  if (!ours(pid, started)) {
    teeAppend(log, `pid ${pid} exited ${((Date.now() - begun) / 1000).toFixed(1)}s after SIGTERM`);
    return;
  }
  teeAppend(log, `pid ${pid} still alive after ${graceS}s; SIGKILL`);
  process.kill(pid, "SIGKILL");
  for (let i = 0; i < 25 && ours(pid, started); i++) await sleep(200);
}

async function cmdRestart(r: Run): Promise<number> {
  const log = path.join(r.art, "restart.txt");
  teeAppend(log, `restart at ${stamp()}`);
  await stopPid(r.collectorPid, r.collectorStarted, 60, log);
  const tail = (readText(collectorLog(r)) ?? "").split("\n").filter((l) => /Shutdown complete|Starting shutdown|\terror\t/.test(l)).slice(-5);
  for (const l of tail) teeAppend(log, `  ${l}`);
  const p = PROFILES[r.profile];
  copyFileSync(path.join(REPO, p.config), path.join(r.art, "collector-config.yaml"));
  teeAppend(log, `config snapshot refreshed from ${p.config}`);
  r.collectorPid = startCollector(r);
  r.collectorStarted = startedAt(r.collectorPid);
  saveRun(r);
  await waitFor("collector after restart", 60, () => collectorReady(r), () => isAlive(r.collectorPid), collectorLog(r));
  teeAppend(log, `COLLECTOR RESTARTED run=${r.id} pid=${r.collectorPid}`);
  return 0;
}

function cmdEnv(): number {
  const r = loadRun();
  const vars: Record<string, string> = {
    RUN_ID: r.id,
    PROFILE: r.profile,
    OTLP_HTTP_ORIGIN: r.otlpHttp,
    OTLP_GRPC_ORIGIN: r.otlpGrpc,
    GITHUB_WEBHOOK_URL: r.github ? `${r.github}/webhook/github` : "",
    HEALTH_ORIGIN: r.health,
    CLICKHOUSE_ORIGIN: r.clickhouse,
    CLICKHOUSE_USER: "default",
    CLICKHOUSE_PASSWORD: CH_PASSWORD,
    COMPOSE_PROJECT: r.project,
    VERIFY_ORIGIN: r.verify,
    COLLECTOR_LOG: collectorLog(r),
    VERIFY_LOG: verifyLog(r),
    EVIDENCE: r.art,
  };
  for (const [k, v] of Object.entries(vars)) console.log(`export ${k}='${v}'`);
  return 0;
}

function cmdKeys(): number {
  const r = loadRun();
  for (const [n, k] of Object.entries(loadKeys(r))) console.log(`${n}: ${keyLine(k, PROFILES[r.profile])}`);
  return 0;
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
  const log = path.join(art, "cleanup.txt");
  const state = readText(path.join(dir, "run.json"));
  const r = state === undefined ? undefined : (JSON.parse(state) as Run);
  const project = composeProject(runId);
  if (r) {
    await stopPid(r.collectorPid, r.collectorStarted, 60, log);
    await stopPid(r.stubPid, r.stubStarted, 10, log);
    for (const f of ["collector.log", "verify.log", "verify-stub.log"]) {
      if (existsSync(path.join(dir, f))) copyFileSync(path.join(dir, f), path.join(art, f));
    }
  }
  const env = { ...process.env, DEV_ROOT: REPO };
  const dc = (args: string[]) => run("docker", ["compose", "-p", project, "-f", COMPOSE_FILE, ...args], { env });
  writeFileSync(path.join(art, "clickhouse.log"), dc(["logs", "--no-color"]).stdout);
  const down = dc(["down", "-v", "--timeout", "10"]);
  teeAppend(log, `docker compose -p ${project} down -v: exit ${down.status}`);
  const label = `label=com.docker.compose.project=${project}`;
  const left = [
    ...run("docker", ["ps", "-aq", "--filter", label]).stdout.split("\n"),
    ...run("docker", ["volume", "ls", "-q", "--filter", label]).stdout.split("\n"),
    ...run("docker", ["network", "ls", "-q", "--filter", label]).stdout.split("\n"),
  ].filter(Boolean);
  const open = r ? [r.otlpHttp, r.otlpGrpc, r.github, r.health, r.verify].filter((o) => o && portPids(portOf(o))) : [];
  for (const o of open) teeAppend(log, `WARN ${o} still listening`);
  // A process that is alive but not listening (a collector still starting) would be lost with run.json.
  const alive = r ? [[r.collectorPid, r.collectorStarted] as const, [r.stubPid, r.stubStarted] as const].filter(([pid, started]) => ours(pid, started)).map(([pid]) => `pid ${pid}`) : [];
  for (const p of alive) teeAppend(log, `WARN ${p} still running`);
  if (left.length || down.status !== 0 || open.length || alive.length) {
    teeAppend(log, `left for ${project}: ${[...left, ...open, ...alive].join(" ")}; scratch kept. Fix it and rerun cleanup.`);
    return 1;
  }
  teeAppend(log, `docker resources for ${project}: none left`);
  rmSync(toDelete, { recursive: true, force: true });
  if (readPointer(CURRENT) === runId) rmSync(CURRENT, { force: true });
  console.log(`cleaned up run ${runId}; evidence kept at ${art}`);
  listDir(art);
  return 0;
}

// Drive commands and the evidence folder each one writes under.
const DRIVE = new Map([["otlp", "http"], ["grpc", "grpc"], ["webhook", "http"], ["http", "http"], ["ch", "db"], ["ch-until", "db"]]);

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  const kind = DRIVE.get(cmd);
  if (kind) {
    // Labels name evidence folders: one flat, safe path segment, checked before the command sends anything.
    const label = positional(args)[0] ?? "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) die(`${cmd} needs a label of letters, digits, '.', '_', '-' first`);
    const out = path.join(loadRun().art, kind, label);
    if (existsSync(out)) die(`evidence ${out} exists; labels must be unique within a run (nothing was sent)`);
  }
  switch (cmd) {
    case "launch":
      return cmdLaunch(args);
    case "doctor":
      return cmdDoctor();
    case "env":
      return cmdEnv();
    case "keys":
      return cmdKeys();
    case "key": {
      const k = loadKeys(loadRun())[required(args[0], "key name")];
      if (!k) die(`no key '${args[0]}'`);
      console.log(k.key);
      return 0;
    }
    case "otlp":
      return cmdOtlp(loadRun(), args);
    case "grpc":
      return cmdGrpc(loadRun(), args);
    case "webhook":
      return cmdWebhook(loadRun(), args);
    case "http":
      return cmdHttp(loadRun(), args);
    case "ch":
      return cmdCh(loadRun(), args);
    case "ch-until":
      return cmdChUntil(loadRun(), args);
    case "restart":
      return cmdRestart(loadRun());
    case "cleanup":
      return cmdCleanup();
    case "_verify-stub":
      await cmdVerifyStub(required(args[0], "run dir"));
      return -1;
    default:
      console.log(USAGE);
      return 2;
  }
}

const rc = await main(process.argv.slice(2));
if (rc >= 0) process.exit(rc);
