// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  CRM_QUEUE,
  FULL_SYNC_TASK,
  MEMBERSHIP_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  USER_SYNC_TASK,
} from "../src/crm/commands";

const mocks = vi.hoisted(() => ({ query: vi.fn(), end: vi.fn() }));
vi.mock("pg", () => ({
  Pool: class {
    query = mocks.query;
    end = mocks.end;
  },
}));
const argv = process.argv;
const exitCode = process.exitCode;
beforeEach(() => {
  vi.resetModules();
  mocks.query.mockReset().mockResolvedValue({ rows: [{ id: "job-1" }] });
  mocks.end.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("CRM_BREVO_MODE", "configured");
  vi.stubEnv("DATABASE_URL", "postgres://fixture@localhost/fixture");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  process.argv = argv;
  process.exitCode = exitCode;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([
  { args: [], task: FULL_SYNC_TASK, fields: { prune: false, apply: false } },
  { args: ["--prune"], task: FULL_SYNC_TASK, fields: { prune: true, apply: false } },
  { args: ["--prune", "--apply"], task: FULL_SYNC_TASK, fields: { prune: true, apply: true } },
  { args: ["--user-id", "u"], task: USER_SYNC_TASK, fields: { userId: "u" } },
  {
    args: ["--organization-id", "o"],
    task: ORGANIZATION_SYNC_TASK,
    fields: { organizationId: "o" },
  },
  {
    args: ["--user-id", "u", "--organization-id", "o"],
    task: MEMBERSHIP_SYNC_TASK,
    fields: { userId: "u", organizationId: "o" },
  },
])(
  "admits $args through the shared queue and reports admission only",
  async ({ args, task, fields }) => {
    process.argv = ["node", "crm-sync.ts", ...args];
    await import("./crm-sync");
    await vi.waitFor(() => expect(mocks.end).toHaveBeenCalledOnce());
    const parameters = mocks.query.mock.calls[0][1];
    expect(parameters[0]).toBe(task);
    expect(JSON.parse(parameters[1])).toMatchObject(fields);
    expect(parameters[2]).toBe(CRM_QUEUE);
    expect(parameters[3]).toBe(8);
    expect(JSON.parse(vi.mocked(console.info).mock.calls[0][0])).toMatchObject({
      jobId: "job-1",
      task,
      admitted: 1,
      remoteConverged: false,
    });
  },
);

it.each([
  ["--apply"],
  ["--user-id", "u", "--prune"],
  ["--organization-id", "o", "--apply"],
  ["--user-id", ""],
  ["--unknown"],
])("rejects invalid options %s without admission", async (...args) => {
  process.argv = ["node", "crm-sync.ts", ...args];
  await import("./crm-sync");
  await vi.waitFor(() => expect(console.error).toHaveBeenCalledOnce());
  expect(mocks.query).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});

it("admits without provider or unrelated Cloud credentials and ignores provider timeout", async () => {
  vi.stubEnv("CRM_BREVO_TIMEOUT_MS", "not-a-provider-client");
  for (const name of [
    "CRM_BREVO_API_KEY",
    "POLAR_ACCESS_TOKEN",
    "POLAR_WEBHOOK_SECRET",
    "POLAR_PRO_PRODUCT_ID",
    "EMAIL_DSN",
    "EMAIL_FROM",
    "CLICKHOUSE_SQL_API_MASTER_KEY",
  ])
    vi.stubEnv(name, undefined);
  process.argv = ["node", "crm-sync.ts"];
  await import("./crm-sync");
  await vi.waitFor(() => expect(mocks.end).toHaveBeenCalledOnce());
  expect(mocks.query).toHaveBeenCalledOnce();
  expect(console.error).not.toHaveBeenCalled();
});

it.each([undefined, "", "disabled", "paused", "unknown"])(
  "rejects admission in %s mode",
  async (mode) => {
    vi.stubEnv("CRM_BREVO_MODE", mode);
    process.argv = ["node", "crm-sync.ts"];
    await import("./crm-sync");
    await vi.waitFor(() => expect(console.error).toHaveBeenCalledOnce());
    expect(mocks.query).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  },
);

it("rejects admission without a database URL", async () => {
  vi.stubEnv("DATABASE_URL", undefined);
  process.argv = ["node", "crm-sync.ts"];
  await import("./crm-sync");
  await vi.waitFor(() => expect(console.error).toHaveBeenCalledOnce());
  expect(mocks.query).not.toHaveBeenCalled();
  expect(process.exitCode).toBe(1);
});
