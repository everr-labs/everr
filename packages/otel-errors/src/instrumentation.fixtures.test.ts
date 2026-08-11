// These tests start true Node processes with a true NodeSDK. This is
// necessary, because the fatal path ends with process.exit, and thus the same
// process cannot examine it. Each fixture registers the instrumentation as an
// application registers it. Then the fixture prints the data that its
// exporters receive, one JSON object on each line.
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

  it("writes the error to stderr, as Node does with no listener", () => {
    // A listener prevents the report that Node writes. Thus the
    // instrumentation writes it. Without this line the crash of a container is
    // visible only in the telemetry.
    const { stderr } = runFixture("uncaught-exit.mjs");
    expect(stderr).toContain("fixture-crash");
    expect(stderr).toContain("uncaught-exit.mjs");
  });

  it("leaves the exit to the app when the app has its own listener", () => {
    const { status, logs, stderr } = runFixture("other-handler-no-exit.mjs");
    expect(status).toBe(0);
    // The instrumentation captured the error and wrote it, but the listener of
    // the app keeps the exit decision.
    expect(logs.at(-1)).toMatchObject({ mechanism: "uncaughtException" });
    expect(stderr).toContain("fixture-other-handler");
  });

  it("exitEvenIfOtherHandlersAreRegistered stops the process anyway", () => {
    const { status, logs } = runFixture("other-handler-force-exit.mjs");
    // A status of 7 is the fallback in the fixture. It shows that the
    // instrumentation did not stop the process.
    expect(status).toBe(1);
    expect(logs.at(-1)).toMatchObject({ mechanism: "uncaughtException" });
  });
});
