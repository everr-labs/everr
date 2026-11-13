// These tests start true Node processes with a true NodeSDK. This is
// necessary, because the fatal path ends with process.exit, and thus the same
// process cannot examine it. Each fixture registers the instrumentation as an
// application registers it. Then the fixture prints the data that its
// exporters receive, one JSON object on each line.
import { execFile, execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vite-plus/test";

const TEST_FILE_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(TEST_FILE_DIR, "..");

type Line = { kind: "log" | "span" | "metric" } & Record<string, unknown>;

type FixtureResult = {
  status: number | null;
  stderr: string;
  logs: Line[];
  spans: Line[];
  metrics: Line[];
};

const FIXTURES = [
  "uncaught-exit.mjs",
  "rejection-warn.mjs",
  "rejection-exit.mjs",
  "uncaught-continue.mjs",
  "other-handler-no-exit.mjs",
  "next-filter-no-exit.mjs",
  "worker-crash.mjs",
  "other-handler-force-exit.mjs",
] as const;

function spawnFixture(name: string): Promise<FixtureResult> {
  const fixture = resolve(PKG_ROOT, "test/fixtures", name);
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [fixture],
      { encoding: "utf8", timeout: 15_000 },
      (_error, stdout, stderr) => {
        const lines = stdout.trim().split("\n").filter(Boolean);
        const records = lines.map((l) => JSON.parse(l) as Line);
        resolve({
          status: child.exitCode,
          stderr,
          logs: records.filter((r) => r.kind === "log"),
          spans: records.filter((r) => r.kind === "span"),
          metrics: records.filter((r) => r.kind === "metric"),
        });
      },
    );
  });
}

const results = new Map<string, FixtureResult>();

function runFixture(name: (typeof FIXTURES)[number]) {
  const result = results.get(name);
  if (!result) throw new Error(`fixture ${name} did not run`);
  return result;
}

describe("node fatal exit semantics (fixtures)", () => {
  // Each fixture is a separate Node process, so they run in parallel once up
  // front instead of one spawn per test.
  beforeAll(async () => {
    execSync("pnpm build", { cwd: PKG_ROOT, stdio: "inherit" });
    const outcomes = await Promise.all(FIXTURES.map(spawnFixture));
    FIXTURES.forEach((name, i) => results.set(name, outcomes[i]));
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

  it("unhandledRejection: captures as error and keeps the process alive by default", () => {
    const { status, logs, stderr } = runFixture("rejection-warn.mjs");
    expect(status).toBe(0);
    expect(logs.at(-1)).toMatchObject({
      mechanism: "unhandledrejection",
      severityNumber: 17,
    });
    expect(stderr).toContain("fixture-rejection");
  });

  it("unhandledRejection strict: flushes the record then exits 1", () => {
    const { status, logs } = runFixture("rejection-exit.mjs");
    expect(status).toBe(1);
    expect(logs.at(-1)).toMatchObject({
      mechanism: "unhandledrejection",
      severityNumber: 21,
    });
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

  it("strict: sees the listener of the app behind the unhandledRejection filter of Next.js", () => {
    const { status, logs, stderr } = runFixture("next-filter-no-exit.mjs");
    expect(status).toBe(0);
    expect(logs.at(-1)).toMatchObject({ mechanism: "unhandledrejection" });
    expect(stderr).toContain("next-log");
  });

  it("installs no crash handlers in a worker thread, so the parent still gets the error event", () => {
    const { status } = runFixture("worker-crash.mjs");
    expect(status).toBe(0);
  });

  it("exitEvenIfOtherHandlersAreRegistered stops the process anyway", () => {
    const { status, logs } = runFixture("other-handler-force-exit.mjs");
    // A status of 7 is the fallback in the fixture. It shows that the
    // instrumentation did not stop the process.
    expect(status).toBe(1);
    expect(logs.at(-1)).toMatchObject({ mechanism: "uncaughtException" });
  });
});
