#!/usr/bin/env node
// Agent-driven eval for the everr-setup-telemetry skill.
//
// For one framework it scaffolds a fresh project in a temp dir, copies the
// skill into the project's .claude/skills/, lets a headless Claude Code agent
// instrument the app from the prompt alone, then grades objectively: the
// production build passes, the app boots, and the local collector holds fresh
// browser rows, server rows, and at least one trace joining both halves.
//
// Usage:
//   node evals/setup-telemetry/run.mjs --framework tanstack-start|nextjs|vite-ssr [--keep] [--model <model>] [--port <port>]
//
// Requires: everr-dev collector running, `claude` CLI, `agent-browser` CLI.
//
// The @everr/* packages the skill prescribes are not on public npm yet, so the
// runner builds them from the monorepo, publishes them to a throwaway local
// verdaccio registry that proxies everything else to npmjs, and points the
// scaffold's .npmrc at it. The agent then installs them exactly as a real
// user would once they are published.

import { execSync, spawn } from "node:child_process";
import { mkdtempSync, cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SKILL_DIR = join(
  REPO_ROOT,
  "crates/everr-core/assets/skills/everr-setup-telemetry",
);
const AGENT_TIMEOUT_MS = 30 * 60 * 1000;
const REGISTRY_PORT = 4873;
const REGISTRY = `http://localhost:${REGISTRY_PORT}/`;
const LOCAL_PACKAGES = ["packages/otel-web", "packages/otel-errors"];
const BOOT_TIMEOUT_MS = 90 * 1000;
const FLUSH_WAIT_MS = 12 * 1000;
const DEFAULT_PORT = 4173;

const FRAMEWORKS = {
  "tanstack-start": {
    scaffold: (dir) =>
      run(
        `npx --yes @tanstack/cli@latest create app --framework React --package-manager npm --no-toolchain --no-examples --deployment nitro`,
        dir,
      ),
    build: "npm run build",
    serve: "npm run dev",
  },
  nextjs: {
    scaffold: (dir) =>
      run(
        `npx --yes create-next-app@latest app --ts --app --eslint --no-tailwind --no-src-dir --use-npm --yes`,
        dir,
      ),
    build: "npm run build",
    serve: "npm run dev",
  },
  "vite-ssr": {
    scaffold: (dir) =>
      run(`npm create vite-extra@latest app -- --template ssr-react-ts`, dir),
    build: "npm run build",
    serve: "npm run dev",
  },
};

function run(cmd, cwd, opts = {}) {
  return execSync(cmd, {
    cwd,
    stdio: opts.capture ? "pipe" : "inherit",
    encoding: "utf8",
    env: { ...process.env, ...opts.env, CI: "1" },
    timeout: opts.timeout ?? 10 * 60 * 1000,
  });
}

function localQuery(sql) {
  // Plain `everr`, not `everr-dev`: the agent under eval runs in a fresh
  // project with the public CLI, so the grader must read the same collector
  // store that `everr local status` hands the agent.
  const out = run(`everr local query ${JSON.stringify(sql)}`, REPO_ROOT, {
    capture: true,
  });
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function registryUp() {
  try {
    const res = await fetch(`${REGISTRY}-/ping`);
    return res.ok;
  } catch {
    return false;
  }
}

// Idempotent: reuses a live registry and replaces each package's version so
// the scaffold always installs the current build, never a stale artifact.
async function ensureLocalRegistry() {
  if (!(await registryUp())) {
    const configDir = mkdtempSync(join(tmpdir(), "everr-eval-registry-"));
    writeFileSync(
      join(configDir, "config.yaml"),
      [
        `storage: ${join(configDir, "storage")}`,
        "auth:",
        "  htpasswd:",
        `    file: ${join(configDir, "htpasswd")}`,
        "uplinks:",
        "  npmjs:",
        "    url: https://registry.npmjs.org/",
        "packages:",
        "  '@everr/*':",
        "    access: $all",
        "    publish: $anonymous",
        "  '**':",
        "    access: $all",
        "    proxy: npmjs",
        "log: { type: stdout, level: warn }",
      ].join("\n"),
    );
    spawn(
      "npx",
      ["--yes", "verdaccio", "--config", join(configDir, "config.yaml"), "--listen", String(REGISTRY_PORT)],
      { stdio: "ignore", detached: true },
    ).unref();
    const deadline = Date.now() + 60 * 1000;
    while (!(await registryUp())) {
      if (Date.now() > deadline) throw new Error("verdaccio did not start");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // npm refuses to publish without a token, and verdaccio accepts any.
  const env = { [`npm_config_//localhost:${REGISTRY_PORT}/:_authToken`]: "eval" };
  for (const pkg of LOCAL_PACKAGES) {
    const dir = join(REPO_ROOT, pkg);
    run("pnpm build", dir, { capture: true });
    // The registry persists across runs, so the version can hold a stale
    // artifact from an earlier build. Drop it first; the unpublish fails
    // harmlessly when the version is not there yet.
    const { name, version } = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8"),
    );
    try {
      run(`npm unpublish ${name}@${version} --force --registry ${REGISTRY}`, dir, {
        capture: true,
        env,
      });
    } catch {}
    // pnpm, not npm: it rewrites workspace: dependency ranges to real
    // versions at pack time.
    run(`pnpm publish --registry ${REGISTRY} --no-git-checks`, dir, {
      capture: true,
      env,
    });
  }
}

function prompt(runId) {
  return [
    `Set up Everr telemetry for this app using the everr-setup-telemetry skill: browser and server halves, with browser and server traces joined into single traces.`,
    `Use service.name "${runId}-web" for the browser and "${runId}-server" for the server, exactly.`,
    `Export to the local collector (no production key exists). Validate your work by exercising the app and querying the collector before finishing.`,
  ].join("\n");
}

async function waitForBoot(url) {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`app did not boot at ${url}`);
}

async function main() {
  const args = process.argv.slice(2);
  const framework = args[args.indexOf("--framework") + 1];
  const keep = args.includes("--keep");
  const model = args.includes("--model")
    ? args[args.indexOf("--model") + 1]
    : undefined;
  const PORT = args.includes("--port")
    ? Number(args[args.indexOf("--port") + 1])
    : DEFAULT_PORT;
  const fw = FRAMEWORKS[framework];
  if (!fw) {
    console.error(`--framework must be one of: ${Object.keys(FRAMEWORKS)}`);
    process.exit(2);
  }

  run("everr local status", REPO_ROOT, { capture: true });
  await ensureLocalRegistry();

  const runId = `eval-${framework}-${Date.now().toString(36)}`;
  const workDir = mkdtempSync(join(tmpdir(), `everr-eval-`));
  const appDir = join(workDir, "app");
  const verdict = {
    runId,
    framework,
    scaffold: false,
    agent: false,
    build: false,
    boot: false,
    browserRows: 0,
    serverRows: 0,
    joinedTraces: 0,
    pass: false,
  };

  let server;
  try {
    console.log(`[eval] scaffolding ${framework} in ${appDir}`);
    fw.scaffold(workDir);
    // Some scaffolders (create-next-app) git-init and commit on their own.
    run(
      "git init -q; git add -A; git diff --cached --quiet || git commit -qm scaffold",
      appDir,
    );
    verdict.scaffold = true;

    cpSync(SKILL_DIR, join(appDir, ".claude/skills/everr-setup-telemetry"), {
      recursive: true,
    });
    writeFileSync(join(appDir, ".npmrc"), `registry=${REGISTRY}\n`);

    writeFileSync(join(appDir, "EVAL_PROMPT.md"), prompt(runId));

    console.log(`[eval] running agent (up to 30m)`);
    // --setting-sources project,local keeps auth working but stops user-level
    // config from leaking in: without it, a globally installed (possibly
    // stale) copy of this same skill in ~/.claude/skills shadows the project
    // copy, along with the user's global CLAUDE.md and memory.
    run(
      `claude -p ${JSON.stringify(prompt(runId))} --dangerously-skip-permissions --setting-sources project,local${model ? ` --model ${model}` : ""}`,
      appDir,
      { timeout: AGENT_TIMEOUT_MS },
    );
    verdict.agent = true;

    console.log(`[eval] building`);
    run(fw.build, appDir);
    verdict.build = true;

    console.log(`[eval] booting`);
    server = spawn("sh", ["-c", fw.serve], {
      cwd: appDir,
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
      detached: true,
    });
    await waitForBoot(`http://localhost:${PORT}/`);
    verdict.boot = true;

    console.log(`[eval] driving a real browser`);
    const session = `--session ${runId}`;
    run(`agent-browser open http://localhost:${PORT}/ ${session}`, appDir);
    run(`agent-browser wait --load networkidle ${session}`, appDir);
    run(`agent-browser reload ${session}`, appDir);
    await new Promise((r) => setTimeout(r, FLUSH_WAIT_MS));
    run(`agent-browser close ${session}`, appDir);

    // Browser rows can be logs (pageviews, errors) or spans depending on the
    // SDK the agent chose, so count both tables.
    const counts = localQuery(
      `SELECT ServiceName, sum(c) AS c FROM (SELECT ServiceName, count() AS c FROM traces WHERE Timestamp > now() - INTERVAL 15 MINUTE AND ServiceName IN ('${runId}-web','${runId}-server') GROUP BY ServiceName UNION ALL SELECT ServiceName, count() AS c FROM logs WHERE Timestamp > now() - INTERVAL 15 MINUTE AND ServiceName IN ('${runId}-web','${runId}-server') GROUP BY ServiceName) GROUP BY ServiceName`,
    );
    verdict.browserRows =
      counts.find((r) => r.ServiceName === `${runId}-web`)?.c ?? 0;
    verdict.serverRows =
      counts.find((r) => r.ServiceName === `${runId}-server`)?.c ?? 0;
    verdict.joinedTraces = localQuery(
      `SELECT count() AS c FROM (SELECT TraceId, groupUniqArray(ServiceName) AS s FROM traces WHERE Timestamp > now() - INTERVAL 15 MINUTE AND ServiceName IN ('${runId}-web','${runId}-server') GROUP BY TraceId HAVING length(s) > 1)`,
    )[0]?.c ?? 0;

    verdict.pass =
      verdict.build &&
      verdict.boot &&
      verdict.browserRows > 0 &&
      verdict.serverRows > 0 &&
      verdict.joinedTraces > 0;
  } catch (error) {
    verdict.error = String(error?.message ?? error);
  } finally {
    if (server) process.kill(-server.pid, "SIGTERM");
    if (keep || !verdict.pass) {
      console.log(`[eval] project kept at ${appDir}`);
    } else {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.pass ? 0 : 1);
}

await main();
