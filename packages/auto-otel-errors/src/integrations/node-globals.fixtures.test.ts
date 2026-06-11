import { execSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const TEST_FILE_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(TEST_FILE_DIR, "../..");

function runFixture(name: string) {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(pathToFileURL(resolve(PKG_ROOT, "test/fixtures", name)))],
    { encoding: "utf8", timeout: 15_000 },
  );
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  return { status: result.status, records: lines.map((l) => JSON.parse(l)) };
}

describe("node fatal exit semantics (fixtures)", () => {
  beforeAll(() => {
    execSync("pnpm build", { cwd: PKG_ROOT, stdio: "inherit" });
  }, 120_000);

  it("uncaughtException: flushes the record then exits 1", () => {
    const { status, records } = runFixture("uncaught-exit.mjs");
    expect(status).toBe(1);
    expect(records.at(-1)).toMatchObject({
      mechanism: "uncaughtException",
      severityNumber: 21,
    });
  });

  it("unhandledRejection: flushes the record then exits 1", () => {
    const { status, records } = runFixture("rejection-exit.mjs");
    expect(status).toBe(1);
    expect(records.at(-1)).toMatchObject({ mechanism: "unhandledrejection" });
  });

  it("onFatal continue: captures but does not exit", () => {
    const { status, records } = runFixture("uncaught-continue.mjs");
    expect(status).toBe(0);
    expect(records.at(-1)).toMatchObject({ mechanism: "uncaughtException" });
  });
});
