// Real Node processes, driven by a real NodeSDK, because the fatal path ends
// in process.exit and cannot be observed in-process. Each fixture registers
// the instrumentation the way an application does and prints what its
// exporters receive, one JSON object per line.
import { execSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const TEST_FILE_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(TEST_FILE_DIR, "..");

type Line = { kind: "log" | "span" | "metric" } & Record<string, unknown>;

function runFixture(name: string) {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(pathToFileURL(resolve(PKG_ROOT, "test/fixtures", name)))],
    { encoding: "utf8", timeout: 15_000 },
  );
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  const records = lines.map((l) => JSON.parse(l) as Line);
  return {
    status: result.status,
    stderr: result.stderr,
    logs: records.filter((r) => r.kind === "log"),
    spans: records.filter((r) => r.kind === "span"),
    metrics: records.filter((r) => r.kind === "metric"),
  };
}

describe("node fatal exit semantics (fixtures)", () => {
  beforeAll(() => {
    execSync("pnpm build", { cwd: PKG_ROOT, stdio: "inherit" });
  }, 120_000);

  it("uncaughtException: flushes the record then exits 1", () => {
    const { status, logs } = runFixture("uncaught-exit.mjs");
    expect(status).toBe(1);
    expect(logs.at(-1)).toMatchObject({
      eventName: "exception",
      mechanism: "uncaughtException",
      severityNumber: 21,
    });
  });

  it("uncaughtException: flushes queued spans and metrics too, not only logs", () => {
    const { spans, metrics } = runFixture("uncaught-exit.mjs");
    expect(spans.map((s) => s.name)).toContain("pre-crash");
    expect(metrics.map((m) => m.name)).toContain("pre_crash_total");
  });

  it("unhandledRejection: flushes the record then exits 1", () => {
    const { status, logs } = runFixture("rejection-exit.mjs");
    expect(status).toBe(1);
    expect(logs.at(-1)).toMatchObject({ mechanism: "unhandledrejection" });
  });

  it("onFatal continue: captures but does not exit", () => {
    const { status, logs } = runFixture("uncaught-continue.mjs");
    expect(status).toBe(0);
    expect(logs.at(-1)).toMatchObject({ mechanism: "uncaughtException" });
  });
});
