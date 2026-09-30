import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { copyFile, rename } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createServer, type ViteDevServer } from "vite";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const repoDir = path.resolve(appDir, "../..");
const cliDir = path.join(repoDir, "packages/cli");
const assetsDir = path.join(repoDir, "target/cli-embedded-assets");
const binary = path.join(repoDir, "target/debug/everr-dev");
const backendOrigin = "http://127.0.0.1:54321";
const shutdown = new AbortController();
const tasks = new Set<Task>();
const watchers: FSWatcher[] = [];
let vite: ViteDevServer | undefined;
let backend: Task | undefined;
let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
let rebuildLoop: Promise<void> | undefined;
let dirty = false;

type Task = {
  child: ChildProcess;
  done: Promise<{ code: number | null; error?: Error }>;
  finished: boolean;
};

function start(command: string, args: string[], env = process.env): Task {
  const child = spawn(command, args, {
    cwd: repoDir,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  const task: Task = {
    child,
    finished: false,
    done: new Promise((resolve) => {
      child.once("error", (error) => resolve({ code: null, error }));
      child.once("close", (code) => resolve({ code }));
    }),
  };
  tasks.add(task);
  void task.done.then(() => {
    task.finished = true;
    tasks.delete(task);
  });
  return task;
}

async function run(command: string, args: string[], env = process.env) {
  shutdown.signal.throwIfAborted();
  const result = await start(command, args, env).done;
  shutdown.signal.throwIfAborted();
  if (result.error) throw result.error;
  if (result.code !== 0) throw new Error(`${command} exited with code ${result.code}`);
}

async function stop(task: Task) {
  if (task.finished || !task.child.pid) return;
  const sendSignal = (signal: NodeJS.Signals) => {
    try {
      if (process.platform === "win32") task.child.kill(signal);
      else process.kill(-task.child.pid!, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };
  sendSignal("SIGTERM");
  await Promise.race([task.done, delay(5_000, undefined, { ref: false })]);
  if (!task.finished) sendSignal("SIGKILL");
  await task.done;
}

async function assertBackendPortFree() {
  const probe = createNetServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", () => reject(new Error(
      "Port 54321 is already in use. Stop the existing local CLI, or use pnpm dev:local:ui to attach Vite to it.",
    )));
    probe.listen(54321, "127.0.0.1", () => probe.close(() => resolve()));
  });
}

async function waitForBackend(task: Task) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    shutdown.signal.throwIfAborted();
    if (task.finished) throw new Error("The local CLI stopped before it became ready.");
    try {
      const response = await fetch(backendOrigin, {
        signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(1_000)]),
      });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      shutdown.signal.throwIfAborted();
    }
    await delay(100, undefined, { signal: shutdown.signal });
  }
  throw new Error("The local CLI did not become ready within 20 seconds.");
}

async function rebuildBackend() {
  console.log("[local dev] Building Rust backend...");
  await run("cargo", ["build", "--manifest-path", path.join(cliDir, "Cargo.toml")], {
    ...process.env,
    EVERR_EMBEDDED_COLLECTOR_GZ: path.join(assetsDir, "everr-local-collector.gz"),
    EVERR_EMBEDDED_CHDB_GZ: path.join(assetsDir, "libchdb.so.gz"),
    EVERR_REQUIRE_EMBEDDED_COLLECTOR: "1",
  });
  // A failed build leaves the running backend available. Replace it only after
  // compilation succeeds, and rename the binary to avoid overwriting a running executable.
  const previous = backend;
  backend = undefined;
  if (previous) await stop(previous);
  shutdown.signal.throwIfAborted();
  await copyFile(path.join(repoDir, "target/debug/everr"), `${binary}.tmp`);
  await rename(`${binary}.tmp`, binary);
  const task = start(binary, ["local", "start", "--no-open"]);
  backend = task;
  void task.done.then(({ code, error }) => {
    if (backend === task && !shutdown.signal.aborted) {
      console.error("[local dev] Backend stopped:", error?.message ?? code);
      process.exitCode = 1;
      shutdown.abort();
    }
  });
  await waitForBackend(task);
  console.log("[local dev] Backend ready. UI edits hot reload; Rust edits rebuild and restart.");
  vite?.ws.send({ type: "full-reload" });
}

function scheduleRebuild() {
  dirty = true;
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    if (rebuildLoop || shutdown.signal.aborted) return;
    rebuildLoop = (async () => {
      while (dirty && !shutdown.signal.aborted) {
        dirty = false;
        try {
          await rebuildBackend();
        } catch (error) {
          if (!shutdown.signal.aborted) {
            console.error("[local dev] Rebuild failed. Fix the error and save again.", error);
          }
        }
      }
    })().finally(() => { rebuildLoop = undefined; });
  }, 250);
}

async function main() {
  await assertBackendPortFree();
  const required = [
    path.join(assetsDir, "everr-local-collector.gz"),
    path.join(assetsDir, "libchdb.so.gz"),
    path.join(appDir, "dist/client/_shell.html"),
  ];
  if (!required.every(existsSync)) {
    console.log("[local dev] Preparing embedded assets for the first run...");
    await run("pnpm", ["--filter", "@everr/cli", "build:debug"]);
  }
  await rebuildBackend();
  shutdown.signal.throwIfAborted();
  vite = await createServer({ root: appDir, server: { open: !process.argv.includes("--no-open") } });
  await vite.listen();
  vite.printUrls();

  for (const directory of ["packages/cli/src", "packages/cli/assets"]) {
    watchers.push(watch(path.join(repoDir, directory), { recursive: true }, scheduleRebuild));
  }
  for (const [directory, files] of [
    [repoDir, ["Cargo.toml", "Cargo.lock"]],
    [cliDir, ["Cargo.toml", "build.rs", "package.json"]],
  ] as const) {
    watchers.push(watch(directory, (_event, file) => {
      if (file && files.some((name) => name === file)) scheduleRebuild();
    }));
  }
  if (!shutdown.signal.aborted) {
    await new Promise<void>((resolve) => shutdown.signal.addEventListener("abort", () => resolve(), { once: true }));
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => shutdown.abort());

try {
  await main();
} catch (error) {
  if (!shutdown.signal.aborted) {
    console.error(error);
    process.exitCode = 1;
  }
} finally {
  shutdown.abort();
  clearTimeout(rebuildTimer);
  for (const watcher of watchers) watcher.close();
  await Promise.all([...tasks].map(stop));
  await rebuildLoop;
  await vite?.close();
}
