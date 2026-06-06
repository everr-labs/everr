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

import { notifyAlertUpdate, notifyWorkflowUpdate } from "./notify";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifyWorkflowUpdate", () => {
  it("calls db.execute once with pg_notify to 'workflows'", async () => {
    await notifyWorkflowUpdate(mockDb, {
      tenantId: "42",
      traceId: "abc123",
      runId: "999",
      sha: "deadbeef",
      repo: "org/repo",
      branch: "main",
      authorEmail: "dev@example.com",
      workflowName: "CI",
      name: "CI",
      type: "run",
      status: "completed",
      conclusion: "success",
      jobId: null,
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);

    const sqlArg = mockExecute.mock.calls[0][0];
    const joinedSql = sqlArg.strings.join("?");
    expect(joinedSql).toContain("pg_notify");
    expect(joinedSql).toContain("workflows");
    expect(sqlArg.values).toHaveLength(1);
    expect(JSON.parse(sqlArg.values[0])).toMatchObject({
      kind: "workflow",
      tenantId: "42",
    });
  });

  it("does not throw when db.execute rejects", async () => {
    mockExecute.mockRejectedValue(new Error("connection lost"));

    await expect(
      notifyWorkflowUpdate(mockDb, {
        tenantId: "42",
        traceId: "abc123",
        runId: "999",
        sha: "deadbeef",
        repo: "org/repo",
        branch: "main",
        authorEmail: "dev@example.com",
        workflowName: "CI",
        name: "CI",
        type: "run",
        status: "completed",
        conclusion: "failure",
        jobId: null,
      }),
    ).resolves.not.toThrow();
  });

  it("accepts job type with jobId", async () => {
    await notifyWorkflowUpdate(mockDb, {
      tenantId: "42",
      traceId: "abc123",
      runId: "999",
      sha: "deadbeef",
      repo: "org/repo",
      branch: "main",
      authorEmail: null,
      workflowName: "CI",
      name: "build",
      type: "job",
      status: "completed",
      conclusion: "failure",
      jobId: 12345,
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it("publishes alert payloads on the workflows channel", async () => {
    await notifyAlertUpdate(mockDb, {
      kind: "alert",
      tenantId: "42",
      recipientUserIds: ["u1"],
      alertDefinitionId: 10,
      alertEventId: 20,
      service: "api",
      name: "high-5xx-routes",
      severity: "critical",
      status: "firing",
      summary: "summary",
      description: null,
      occurredAt: "2026-06-06T10:00:00.000Z",
      sourceUrl: "https://github.com/acme/repo/blob/main/alerts.yaml",
      rowCount: 2,
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    const sqlArg = mockExecute.mock.calls[0][0];
    expect(sqlArg.strings.join("?")).toContain("workflows");
    expect(JSON.parse(sqlArg.values[0])).toMatchObject({
      kind: "alert",
      recipientUserIds: ["u1"],
    });
  });
});
