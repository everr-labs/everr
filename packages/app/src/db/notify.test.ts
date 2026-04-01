import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExecute = vi.fn().mockResolvedValue(undefined);
const mockDb = { execute: mockExecute } as unknown as Parameters<
  typeof import("./notify").notifyWorkflowUpdate
>[0];

vi.mock("drizzle-orm", () => ({
  sql: vi.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      ({ strings, values, __drizzle_sql: true }) as unknown,
  ),
}));

import { notifyWorkflowUpdate } from "./notify";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifyWorkflowUpdate", () => {
  it("calls db.execute once with pg_notify to 'workflows'", async () => {
    await notifyWorkflowUpdate(mockDb, {
      tenantId: 42,
      traceId: "abc123",
      runId: "999",
      sha: "deadbeef",
      authorEmail: "dev@example.com",
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);

    const sqlArg = mockExecute.mock.calls[0][0];
    const joinedSql = sqlArg.strings.join("?");
    expect(joinedSql).toContain("pg_notify");
    expect(joinedSql).toContain("workflows");
    expect(sqlArg.values).toHaveLength(1);
  });

  it("does not throw when db.execute rejects", async () => {
    mockExecute.mockRejectedValue(new Error("connection lost"));

    await expect(
      notifyWorkflowUpdate(mockDb, {
        tenantId: 42,
        traceId: "abc123",
        runId: "999",
        sha: "deadbeef",
        authorEmail: "dev@example.com",
      }),
    ).resolves.not.toThrow();
  });
});
