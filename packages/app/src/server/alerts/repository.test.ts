import type { QueryResultRow } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { pool } from "@/db/client";
import {
  claimDueAlertDefinitions,
  createAlertEvent,
  deleteExpiredAlertEvents,
  getAlertDefinitionForEvaluation,
  listAlertRules,
  updateAlertState,
  upsertAlertDefinitions,
} from "./repository";

const mockedQuery = vi.mocked(
  pool.query as (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{ rows: QueryResultRow[]; rowCount?: number | null }>,
);

const now = new Date("2026-06-06T10:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("alert repository", () => {
  it("upserts alert definitions by organization, service, and name", async () => {
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await upsertAlertDefinitions({
      organizationId: "org1",
      rawYaml: "version: everr/v1",
      sourceUrl: "https://github.com/acme/repo/blob/main/alerts.yaml",
      userId: "user1",
      now,
      alerts: [
        {
          service: "api",
          name: "high-5xx-routes",
          severity: "critical",
          routing: "admins",
          evaluationIntervalSeconds: 60,
          windowSeconds: 300,
          query: "SELECT 1",
          summary: "summary",
          description: null,
        },
      ],
    });

    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const [sql, values] = mockedQuery.mock.calls[0] ?? [];
    expect(sql).toContain("INSERT INTO alert_definitions");
    expect(sql).toContain("ON CONFLICT (organization_id, service, name)");
    expect(values).toEqual([
      "org1",
      "api",
      "high-5xx-routes",
      "critical",
      "admins",
      60,
      300,
      now,
      "version: everr/v1",
      "SELECT 1",
      "summary",
      null,
      "https://github.com/acme/repo/blob/main/alerts.yaml",
      null,
      null,
      null,
      null,
      null,
      "user1",
      "user1",
      now,
    ]);
  });

  it("deactivates omitted definitions from the same organization, service, and source URL", async () => {
    mockedQuery.mockResolvedValue({ rows: [], rowCount: 2 });

    await upsertAlertDefinitions({
      organizationId: "org1",
      rawYaml: "version: everr/v1",
      sourceUrl: "https://github.com/acme/repo/blob/main/alerts.yaml",
      userId: "user1",
      now,
      alerts: [
        {
          service: "api",
          name: "kept",
          severity: "warning",
          routing: "everyone",
          evaluationIntervalSeconds: 300,
          windowSeconds: 900,
          query: "SELECT 1",
          summary: "summary",
          description: "description",
        },
      ],
    });

    const [sql, values] = mockedQuery.mock.calls[1] ?? [];
    expect(sql).toContain("UPDATE alert_definitions");
    expect(sql).toContain("active = false");
    expect(sql).toContain("source_url = $3");
    expect(sql).toContain("name <> ALL($4::text[])");
    expect(values).toEqual([
      "org1",
      "api",
      "https://github.com/acme/repo/blob/main/alerts.yaml",
      ["kept"],
      "user1",
      now,
    ]);
  });

  it("claims due alert definitions with row locks and advances next evaluation", async () => {
    const scheduledFor = new Date("2026-06-06T09:59:00Z");
    mockedQuery.mockResolvedValueOnce({
      rows: [
        {
          alertDefinitionId: 42,
          organizationId: "org1",
          scheduledFor,
        },
      ],
      rowCount: 1,
    });

    const claimed = await claimDueAlertDefinitions({ limit: 25, now });

    expect(claimed).toEqual([
      {
        alertDefinitionId: 42,
        organizationId: "org1",
        scheduledFor,
      },
    ]);
    const [sql, values] = mockedQuery.mock.calls[0] ?? [];
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("LIMIT $2");
    expect(sql).toContain("next_evaluation_at");
    expect(values).toEqual([now, 25]);
  });

  it("deletes alert events older than the retention cutoff without deleting current states", async () => {
    const olderThan = new Date("2026-06-01T00:00:00Z");
    mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 3 });

    await expect(
      deleteExpiredAlertEvents({ olderThan, limit: 1000 }),
    ).resolves.toBe(3);

    const [sql, values] = mockedQuery.mock.calls[0] ?? [];
    expect(sql).toContain("DELETE FROM alert_events");
    expect(sql).not.toContain("alert_states");
    expect(sql).toContain("occurred_at < $1");
    expect(sql).toContain("LIMIT $2");
    expect(values).toEqual([olderThan, 1000]);
  });

  it("lists alert rules with their current state", async () => {
    const row = {
      id: 42,
      organizationId: "org1",
      service: "api",
      name: "high-5xx-routes",
      severity: "critical",
      routingSlug: "admins",
      evaluationIntervalSeconds: 60,
      windowSeconds: 300,
      sourceUrl: "https://github.com/acme/repo/blob/main/alerts.yaml",
      sourceRepo: "acme/repo",
      sourceBranch: "main",
      sourceCommitSha: "abc123",
      sourcePath: "alerts.yaml",
      active: true,
      validationStatus: "valid",
      lastEvaluationStatus: "success",
      lastEvaluationError: null,
      stateStatus: "firing",
      updatedAt: now,
    };
    mockedQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

    await expect(listAlertRules({ organizationId: "org1" })).resolves.toEqual([
      row,
    ]);

    const [sql, values] = mockedQuery.mock.calls[0] ?? [];
    expect(sql).toContain("LEFT JOIN alert_states");
    expect(sql).toContain("WHERE d.organization_id = $1");
    expect(values).toEqual(["org1"]);
  });

  it("loads an alert definition for evaluation", async () => {
    const row = {
      id: 42,
      organizationId: "org1",
      service: "api",
      name: "high-5xx-routes",
      severity: "critical",
      routingSlug: "admins",
      evaluationIntervalSeconds: 60,
      windowSeconds: 300,
      active: true,
      query: "SELECT 1",
      summaryTemplate: "summary",
      descriptionTemplate: null,
    };
    mockedQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

    await expect(
      getAlertDefinitionForEvaluation({ alertDefinitionId: 42 }),
    ).resolves.toEqual(row);

    const [sql, values] = mockedQuery.mock.calls[0] ?? [];
    expect(sql).toContain("FROM alert_definitions");
    expect(sql).toContain("WHERE id = $1");
    expect(values).toEqual([42]);
  });

  it("updates alert state and reports a new firing transition", async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ status: "resolved" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    await expect(
      updateAlertState({
        alertDefinitionId: 42,
        organizationId: "org1",
        evaluatedAt: now,
        rowCount: 2,
        evidence: [{ route: "/api", error_count: 12 }],
        evidenceTruncated: false,
      }),
    ).resolves.toEqual({
      eventType: "firing",
      previousStatus: "resolved",
      currentStatus: "firing",
    });

    expect(mockedQuery.mock.calls[0]?.[0]).toContain("FROM alert_states");
    expect(mockedQuery.mock.calls[1]?.[0]).toContain(
      "last_evaluation_status = 'success'",
    );
    expect(mockedQuery.mock.calls[2]?.[0]).toContain(
      "INSERT INTO alert_states",
    );
    expect(mockedQuery.mock.calls[2]?.[1]).toEqual([
      42,
      "org1",
      now,
      2,
      JSON.stringify([{ route: "/api", error_count: 12 }]),
      false,
    ]);
  });

  it("creates alert events idempotently for a scheduled evaluation", async () => {
    const event = {
      id: 100,
      alertDefinitionId: 42,
      organizationId: "org1",
      type: "firing",
      evaluationScheduledFor: now,
      occurredAt: now,
      summary: "summary",
      description: null,
      rowCount: 1,
      evidence: [{ route: "/api" }],
      evidenceTruncated: false,
      errorMessage: null,
    };
    mockedQuery.mockResolvedValueOnce({ rows: [event], rowCount: 1 });

    await expect(
      createAlertEvent({
        alertDefinitionId: 42,
        organizationId: "org1",
        type: "firing",
        evaluationScheduledFor: now,
        summary: "summary",
        description: null,
        rowCount: 1,
        evidence: [{ route: "/api" }],
        evidenceTruncated: false,
      }),
    ).resolves.toEqual(event);

    const [sql, values] = mockedQuery.mock.calls[0] ?? [];
    expect(sql).toContain("INSERT INTO alert_events");
    expect(sql).toContain("ON CONFLICT");
    expect(values).toEqual([
      42,
      "org1",
      "firing",
      now,
      "summary",
      null,
      1,
      JSON.stringify([{ route: "/api" }]),
      false,
      null,
    ]);
  });
});
