// Web app (packages/app) commands for verify-everr: compose ClickHouse+Postgres in a per-run
// project with its own ports and volumes, run `pnpm dev:web` against it, drive and record it.
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
import { type CollectorPorts, EXAMPLE_CONFIG, type GeneratedConfig, generateCollectorConfig } from "./collector-config.ts";
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
#   verify-everr web-browser-env         export lines for agent-browser: AGENT_BROWSER_SESSION, WEB, SHOTS,
#                                        SDK_PAGE_ORIGIN, and SDK_URL once web-sdk-page ran
#   verify-everr web-http <label> <METHOD> <path> [curl args...]   HTTP against the app, recorded
#   verify-everr web-webhook <label> <event> <payload.json>  signed GitHub webhook (run's own secret)
#   verify-everr web-psql <label> "<SQL>"          read-only psql in this run's Postgres, recorded
#   verify-everr web-ch <label> "<SQL>"            ClickHouse SQL (default user) in this run, recorded
#   verify-everr web-key-save <name>     read text containing an ek_ key on stdin, keep it in the run's scratch dir
#   verify-everr web-seed [--key-name N | --key-file F]   send fixed logs/spans/error over OTLP with a saved
#                                        key (default name: secret), wait until they land
#   verify-everr web-collector-restart   regenerate the collector config from collector/config.example.yml, recreate it
#   verify-everr web-record --steps F [record.ts args]   record a scripted journey as mp4 + key frames into
#                                        <evidence>/video/ (base URL and the run browser's session filled in)
#   verify-everr web-sdk-page [--local]  bundle packages/otel-web/src into a test page, serve it on SDK_PAGE_ORIGIN
#                                        with the saved 'public' key (or the CLI run's collector, no key, with --local)
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

/** Image tag for a source dir: its git tree hash, or `dirty-<hash>` of the working copy when it has
 * local changes. Checkouts with different sources never share (and race on) a tag. */
function sourceTag(dir: string): { tag: string; dirty: boolean } {
  const tree = run("git", ["-C", REPO, "rev-parse", `HEAD:${dir}`]).stdout.trim();
  const status = run("git", ["-C", REPO, "status", "--porcelain", "--", dir]).stdout;
  if (!status.trim()) return { tag: tree.slice(0, 16) || "untracked", dirty: false };
  const h = createHash("sha256").update(tree).update(run("git", ["-C", REPO, "diff", "HEAD", "--binary", "--", dir]).stdout);
  for (const f of run("git", ["-C", REPO, "ls-files", "--others", "--exclude-standard", "--", dir]).stdout.split("\n").filter(Boolean)) {
    h.update(f).update(readFileSync(path.join(REPO, f)));
  }
  return { tag: `dirty-${h.digest("hex").slice(0, 16)}`, dirty: true };
}

const collectorPorts = (w: WebRun): CollectorPorts => ({
  otlpHttp: portOf(w.otlp),
  otlpGrpc: w.vars.OTLP_GRPC_PORT ?? die(`${w.dir}/run.env has no OTLP_GRPC_PORT`),
  clickhouse: portOf(w.clickhouse),
  web: `http://127.0.0.1:${w.port}`,
});

/** Write the run's collector config (scratch, mounted by compose) and a copy in the evidence dir. */
function writeCollectorConfig(w: WebRun): GeneratedConfig {
  const g = generateCollectorConfig(collectorPorts(w));
  writeFileSync(path.join(w.dir, "collector-config.yaml"), g.text);
  writeFileSync(path.join(w.art, "collector-config.yaml"), g.text);
  const summary = Object.entries(g.pipelines).map(([n, p]) => `${n}: ${p.receivers.join(",")} -> ${p.exporters.join(",")}`);
  console.log(`collector config from ${path.relative(REPO, EXAMPLE_CONFIG)}: dropped pipelines [${g.removedPipelines.join(", ")}]; CORS headers [${g.corsHeaders.join(", ") || "none"}]`);
  for (const s of summary) console.log(`  ${s}`);
  return g;
}

/** CORS preflight a browser sends before an OTLP export: status and Access-Control-Allow-Origin. */
async function corsPreflight(w: WebRun, g: GeneratedConfig): Promise<{ status: number; allowOrigin: string }> {
  const origin = g.corsOrigins.find((o) => o !== "*") ?? "http://127.0.0.1:1";
  try {
    const res = await fetch(`${w.otlp}/v1/logs`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": // Browsers send these lowercased and sorted; the collector's CORS library rejects other orders.
        g.corsHeaders.map((h) => h.toLowerCase()).sort().join(","),
      },
      signal: AbortSignal.timeout(5000),
    });
    return { status: res.status, allowOrigin: res.headers.get("access-control-allow-origin") ?? "" };
  } catch {
    return { status: 0, allowOrigin: "" };
  }
}

async function waitCollector(w: WebRun): Promise<void> {
  // The collector has no healthcheck: ready = its OTLP/HTTP receiver answers and rejects a request without a key.
  const deadline = Date.now() + 60000;
  while ((await otlpUnauthStatus(w)) !== 401) {
    if (Date.now() >= deadline) die("collector OTLP receiver never answered 401 without a key; see 'compose logs collector'");
    await sleep(1000);
  }
}

const keyFile = (w: WebRun, name: string) => {
  if (!/^[a-z0-9-]+$/.test(name)) die(`key name must match [a-z0-9-]+: ${name}`);
  return path.join(w.dir, "keys", name);
};

/** ClickHouse SQL as the default user (`curl -fsS -u default:everr --data-binary`). */
async function chSql(clickhouse: string, sql: string): Promise<{ ok: boolean; text: string }> {
  const r = await http(`${clickhouse}/`, { method: "POST", body: sql, headers: { Authorization: basicAuth("default", "everr") } });
  return { ok: r.ok, text: r.ok ? r.text : `${r.error ?? `HTTP ${r.status}`}\n${r.text}` };
}

const rowPolicies = async (clickhouse: string) =>
  // Per-organization policies (sql_api_org_*) appear when the app provisions an org; count the init ones.
  (await chSql(clickhouse, "SELECT count() FROM system.row_policies WHERE short_name NOT LIKE 'sql_api_org_%'")).text.trim();

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
  const sdkPage = await freePort();
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
  const chImage = sourceTag("clickhouse");
  const colImage = sourceTag("collector");
  writeFileSync(
    path.join(dir, "compose.env"),
    [
      `VERIFY_CH_PORT=${ch}`, `VERIFY_PG_PORT=${pg}`,
      `VERIFY_COLLECTOR_CONFIG=${path.join(dir, "collector-config.yaml")}`,
      `VERIFY_CLICKHOUSE_TAG=${chImage.tag}`, `VERIFY_COLLECTOR_TAG=${colImage.tag}`,
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
    SDK_PAGE_ORIGIN: `http://127.0.0.1:${sdkPage}`,
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
      `images: everr-verify-clickhouse:${chImage.tag} everr-verify-collector:${colImage.tag}`,
      `launched_at: ${stamp()}`,
      "",
    ].join("\n"),
  );
  console.log(`launching web run ${id} (project ${project}, ch :${ch}, pg :${pg}, web :${web}, otlp http :${otlpHttp} grpc :${otlpGrpc}, sdk page :${sdkPage})`);
  writeCollectorConfig(w);

  const t0 = Date.now();
  const secs = () => Math.floor((Date.now() - t0) / 1000);
  const buildLog = path.join(art, "compose-build.log");
  // Build only what this source tree has no image for yet (a dirty tree always rebuilds).
  const toBuild = [
    ["clickhouse", "everr-verify-clickhouse", chImage],
    ["collector", "everr-verify-collector", colImage],
  ] as const;
  const services = toBuild
    .filter(([, repo, img]) => img.dirty || docker(w, ["image", "inspect", `${repo}:${img.tag}`]).status !== 0)
    .map(([svc]) => svc);
  if (services.length) {
    console.log(`building ${services.join(" + ")} image(s) for this source tree (cold collector build ~80s)`);
    if (composeToFile(w, ["build", ...services], buildLog) !== 0) {
      tail(buildLog, 20);
      die(`${services.join("/")} image build failed`);
    }
  } else {
    writeFileSync(buildLog, `images for this source tree already exist: everr-verify-clickhouse:${chImage.tag} everr-verify-collector:${colImage.tag}\n`);
  }
  const upLog = path.join(art, "compose-up.log");
  // The collector is NOT started here: its ClickHouse exporters detect the table schema once at
  // startup, and against a half-initialized ClickHouse that fails ("connection reset") and the
  // collector then writes logs without the attribute-key columns (/errors shows nothing).
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
  // ClickHouse init is complete (every row policy exists): only now start the collector.
  if (composeToFile(w, ["up", "-d", "--no-deps", "collector"], upLog, true) !== 0) {
    tail(upLog, 20);
    die("collector start failed; run 'verify-everr web-cleanup'");
  }
  await waitCollector(w);
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
  // Schema detection runs once at collector start; a failure there silently drops columns.
  const collectorLog = compose(w, ["logs", "--no-color", "collector"]);
  const schemaErrors = `${collectorLog.stdout}${collectorLog.stderr}`.split("\n").filter((l) => /schema detection failed|connection reset/i.test(l));
  check(`collector log has no ClickHouse schema-detection errors (${schemaErrors.length} found)`, schemaErrors.length === 0);
  if (schemaErrors.length) console.log(`     ${schemaErrors[0].slice(0, 200)}\n     the collector started before ClickHouse was ready: run '$V web-collector-restart'`);
  // The running config must be what collector/config.example.yml generates now (else: web-collector-restart).
  const fresh = generateCollectorConfig(collectorPorts(w));
  const used = readText(path.join(w.dir, "collector-config.yaml")) ?? "";
  const kept = Object.values(fresh.pipelines);
  const exporters = [...new Set(kept.flatMap((p) => p.exporters))].filter((e) => fresh.exporters.includes(e)).sort();
  check(
    `collector config matches collector/config.example.yml (pipelines ${Object.keys(fresh.pipelines).length}, exporters ${exporters.join(", ")})`,
    used === fresh.text,
  );
  if (used !== fresh.text) console.log("     the example changed since launch (or the file was edited): run '$V web-collector-restart'");
  if (fresh.corsHeaders.length) {
    const pre = await corsPreflight(w, fresh);
    check(
      `CORS preflight with the example's allowed_headers [${fresh.corsHeaders.join(", ")}] -> ${pre.status} (want 204 + Access-Control-Allow-Origin)`,
      pre.status === 204 && pre.allowOrigin !== "",
    );
  } else {
    console.log("info collector/config.example.yml sets no CORS on the public OTLP/HTTP receiver; browser ingest is not expected to work");
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
  const [cmd, psqlArgs] = composeArgs(w, [
    "exec", "-T", "postgres", "psql", "-U", "postgres", "-tA", "-c",
    // better-auth stores the key hashed plus its first characters in `start`; the key matched
    // /ek_[A-Za-z0-9_-]+/ above, so it is safe to inline.
    `select reference_id from apikey where start <> '' and strpos('${key}', start) = 1 order by created_at desc limit 1`,
  ]);
  const org = run(cmd, psqlArgs).stdout.trim();
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
  writeCollectorConfig(w);
  const log = path.join(w.art, "compose-collector-restart.log");
  if (composeToFile(w, ["up", "-d", "--force-recreate", "--no-deps", "collector"], log, true) !== 0) {
    tail(log, 20);
    die("collector recreate failed");
  }
  await waitCollector(w);
  console.log(`COLLECTOR READY otlp=${w.otlp}`);
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
    stopGroup(path.join(dir, "sdk-page.pgid"));
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
  "web-key-save": cmdWebKeySave,
  "web-collector-restart": cmdWebCollectorRestart,
  "web-sdk-page": cmdWebSdkPage,
  "web-record": cmdWebRecord,
  "web-cleanup": cmdWebCleanup,
};
