import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplyValidationError } from "@/data/as-code/errors";
import { db } from "@/db/client";
import { querySqlApiWithMeta } from "@/lib/clickhouse";

let insertValues: unknown[] = [];
let updateSets: unknown[] = [];
let deleteCalled = false;

vi.mock("@/db/client", () => {
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => Promise.resolve([])),
  };
  const updateChain = {
    set: vi.fn((values: unknown) => {
      updateSets.push(values);
      return updateChain;
    }),
    where: vi.fn(() => []),
  };
  const insertChain = {
    values: vi.fn((values: unknown) => {
      insertValues.push(values);
      return insertChain;
    }),
  };
  const deleteChain = {
    where: vi.fn(() => {
      deleteCalled = true;
      return [];
    }),
  };

  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
      delete: vi.fn(() => deleteChain),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          insert: vi.fn(() => insertChain),
          update: vi.fn(() => updateChain),
          delete: vi.fn(() => deleteChain),
        }),
      ),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
  eq: vi.fn((left: unknown, right: unknown) => ({ op: "eq", left, right })),
}));

vi.mock("@/db/schema", () => ({
  alertDefinitions: {
    organizationId: "organization_id",
    repoid: "repoid",
    slug: "slug",
    evaluationIntervalSeconds: "evaluation_interval_seconds",
    document: "document",
    parsedQuery: "parsed_query",
    summaryTemplate: "summary_template",
    descriptionTemplate: "description_template",
    nextEvaluationAt: "next_evaluation_at",
    scheduleJitterSeconds: "schedule_jitter_seconds",
    configFilePath: "config_file_path",
    sourceLink: "source_link",
    createdAt: "created_at",
    updatedAt: "updated_at",
    active: "active",
    lastEvaluationStatus: "last_evaluation_status",
    lastEvaluationError: "last_evaluation_error",
    currentState: "current_state",
    lastEvaluatedAt: "last_evaluated_at",
    lastFiredAt: "last_fired_at",
    lastResolvedAt: "last_resolved_at",
    lastSeenAt: "last_seen_at",
    lastRowCount: "last_row_count",
    lastEvidenceSnapshot: "last_evidence_snapshot",
    instanceLabelColumns: "instance_label_columns",
  },
}));

vi.mock("@/lib/clickhouse", () => ({
  querySqlApiWithMeta: vi.fn(),
}));

import { applyAlertSpecs } from "./apply.server";

const mockedDb = vi.mocked(db);
const mockedQuerySqlApiWithMeta = vi.mocked(querySqlApiWithMeta);

beforeEach(() => {
  vi.clearAllMocks();
  insertValues = [];
  updateSets = [];
  deleteCalled = false;
  mockedQuerySqlApiWithMeta.mockResolvedValue({
    rows: [],
    columns: ["service", "count"],
  });
});

function mockApplySelect(rows: unknown[]) {
  mockedDb.select.mockImplementationOnce(
    () =>
      ({
        from: () => ({
          where: () => Promise.resolve(rows),
        }),
      }) as unknown as ReturnType<typeof mockedDb.select>,
  );
}

function alert(name = "high-errors", overrides = {}) {
  return {
    kind: "AlertRule",
    metadata: { name },
    spec: {
      evaluationInterval: "5m",
      summary: `\${row_count} errors in \${top_service}`,
      description: `top service \${top_service}`,
      query:
        "SELECT service, count() AS count FROM logs WHERE timestamp > now() - INTERVAL 15 MINUTE GROUP BY service",
      ...overrides,
    },
  };
}

describe("applyAlertSpecs", () => {
  it("validates, renders, and returns a dry-run diff without writes", async () => {
    mockApplySelect([]);

    const result = await applyAlertSpecs({
      orgId: "org-1",
      repoid: "repo-1",
      dryRun: true,
      resources: [{ path: "alerts/high-errors.yaml", resource: alert() }],
    });

    expect(result).toEqual({
      created: ["high-errors"],
      updated: [],
      deleted: [],
    });
    expect(mockedQuerySqlApiWithMeta).toHaveBeenCalledWith(
      expect.stringContaining("INTERVAL 15 MINUTE"),
      "org-1",
    );
    expect(mockedDb.transaction).not.toHaveBeenCalled();
  });

  it("creates active valid alerts and persists source/path metadata", async () => {
    mockedQuerySqlApiWithMeta.mockResolvedValueOnce({
      rows: [{ service: "api", count: 3 }],
      columns: ["service", "count"],
    });
    mockApplySelect([]);

    const result = await applyAlertSpecs({
      orgId: "org-1",
      repoid: "repo-1",
      source: {
        remote: "git@github.com:everr/example.git",
        commitSha: "abc123",
      },
      resources: [{ path: "alerts/high-errors.yaml", resource: alert() }],
    });

    expect(result.created).toEqual(["high-errors"]);
    expect(mockedDb.transaction).toHaveBeenCalledOnce();
    expect(insertValues).toHaveLength(1);
    const batch = insertValues[0] as Record<string, unknown>[];
    expect(batch).toHaveLength(1);
    const created = batch[0];
    expect(created).toMatchObject({
      organizationId: "org-1",
      repoid: "repo-1",
      slug: "high-errors",
      evaluationIntervalSeconds: 300,
      parsedQuery: expect.stringContaining("INTERVAL 15 MINUTE"),
      summaryTemplate: `\${row_count} errors in \${top_service}`,
      descriptionTemplate: `top service \${top_service}`,
      configFilePath: "alerts/high-errors.yaml",
      sourceLink:
        "https://github.com/everr/example/blob/abc123/alerts/high-errors.yaml",
      active: true,
    });
    expect(created).not.toHaveProperty("currentState");
    expect(created).not.toHaveProperty("lastEvaluatedAt");
    expect(created).not.toHaveProperty("lastFiredAt");
    expect(created).not.toHaveProperty("lastSeenAt");
    expect(created).not.toHaveProperty("lastRowCount");
    expect(created).not.toHaveProperty("lastEvidenceSnapshot");
  });

  it("updates changed alerts and deactivates missing active alerts", async () => {
    mockApplySelect([
      {
        slug: "high-errors",
        evaluationIntervalSeconds: 60,
        document: "{}",
        parsedQuery: "SELECT 1",
        summaryTemplate: "old",
        descriptionTemplate: "",
        scheduleJitterSeconds: 0,
        configFilePath: "old.yaml",
        sourceLink: "",
        active: true,
        currentState: "resolved",
        lastRowCount: 0,
      },
      {
        slug: "stale",
        evaluationIntervalSeconds: 300,
        document: "{}",
        parsedQuery: "SELECT 1",
        summaryTemplate: "old",
        descriptionTemplate: "",
        scheduleJitterSeconds: 0,
        configFilePath: "stale.yaml",
        sourceLink: "",
        active: true,
        currentState: "resolved",
        lastRowCount: 0,
      },
    ]);

    const result = await applyAlertSpecs({
      orgId: "org-1",
      repoid: "repo-1",
      resources: [{ path: "alerts/high-errors.yaml", resource: alert() }],
    });

    expect(result).toEqual({
      created: [],
      updated: ["high-errors"],
      deleted: ["stale"],
    });
    expect(updateSets).toEqual([
      expect.objectContaining({ active: true }),
      expect.objectContaining({ active: false, nextEvaluationAt: null }),
    ]);
    expect(deleteCalled).toBe(false);
    expect(eq).toHaveBeenCalledWith("repoid", "repo-1");
  });

  it("rejects duplicate alert names before querying ClickHouse", async () => {
    await expect(
      applyAlertSpecs({
        orgId: "org-1",
        repoid: "repo-1",
        resources: [
          { path: "a.yaml", resource: alert("same") },
          { path: "b.yaml", resource: alert("same") },
        ],
      }),
    ).rejects.toThrow(/duplicate alert "same" \(a\.yaml and b\.yaml\)/);

    expect(mockedQuerySqlApiWithMeta).not.toHaveBeenCalled();
  });

  it("resets runtime state when reviving an inactive alert", async () => {
    mockApplySelect([
      {
        slug: "high-errors",
        evaluationIntervalSeconds: 300,
        document: "{}",
        parsedQuery: "SELECT 1",
        summaryTemplate: "old",
        descriptionTemplate: "",
        scheduleJitterSeconds: 0,
        configFilePath: "old.yaml",
        sourceLink: "",
        active: false,
      },
    ]);

    const result = await applyAlertSpecs({
      orgId: "org-1",
      repoid: "repo-1",
      resources: [{ path: "alerts/high-errors.yaml", resource: alert() }],
    });

    expect(result.updated).toEqual(["high-errors"]);
    expect(updateSets[0]).toMatchObject({
      active: true,
      currentState: "unknown",
      lastEvaluatedAt: null,
      lastFiredAt: null,
      lastResolvedAt: null,
      lastSeenAt: null,
      lastRowCount: 0,
      lastEvidenceSnapshot: [],
      firingInstanceCount: 0,
    });
  });

  it("resets runtime state when query or instance labels change", async () => {
    mockApplySelect([
      {
        slug: "high-errors",
        evaluationIntervalSeconds: 300,
        document: "{}",
        parsedQuery: "SELECT old_service AS service",
        summaryTemplate: `\${row_count} errors in \${top_service}`,
        descriptionTemplate: `top service \${top_service}`,
        instanceLabelColumns: ["old_service"],
        scheduleJitterSeconds: 0,
        configFilePath: "alerts/high-errors.yaml",
        sourceLink: "",
        active: true,
      },
    ]);

    const result = await applyAlertSpecs({
      orgId: "org-1",
      repoid: "repo-1",
      resources: [
        {
          path: "alerts/high-errors.yaml",
          resource: alert("high-errors", { instanceLabels: ["service"] }),
        },
      ],
    });

    expect(result.updated).toEqual(["high-errors"]);
    expect(updateSets[0]).toMatchObject({
      active: true,
      currentState: "unknown",
      lastEvaluatedAt: null,
      lastRowCount: 0,
      lastEvidenceSnapshot: [],
      firingInstanceCount: 0,
    });
  });

  it("rejects invalid schema, intervals, and unsupported variables with path context", async () => {
    await expect(
      applyAlertSpecs({
        orgId: "org-1",
        repoid: "repo-1",
        resources: [{ path: "bad.yaml", resource: { kind: "AlertRule" } }],
      }),
    ).rejects.toThrow(/bad\.yaml: invalid alert rule/);

    await expect(
      applyAlertSpecs({
        orgId: "org-1",
        repoid: "repo-1",
        resources: [
          {
            path: "fast.yaml",
            resource: alert("fast", { evaluationInterval: "30s" }),
          },
        ],
      }),
    ).rejects.toThrow(/fast\.yaml: invalid evaluationInterval/);

    await expect(
      applyAlertSpecs({
        orgId: "org-1",
        repoid: "repo-1",
        resources: [
          {
            path: "bad-var.yaml",
            resource: alert("bad", { query: `SELECT \${tenant}` }),
          },
        ],
      }),
    ).rejects.toThrow(/bad-var\.yaml: unsupported query variable/);
  });

  it("rejects instanceLabels columns the query does not return", async () => {
    await expect(
      applyAlertSpecs({
        orgId: "org-1",
        repoid: "repo-1",
        resources: [
          {
            path: "labels.yaml",
            resource: alert("labels", { instanceLabels: ["missing"] }),
          },
        ],
      }),
    ).rejects.toThrow(
      /labels\.yaml: instanceLabels references column "missing"/,
    );
  });

  it("persists instanceLabelColumns on create", async () => {
    mockApplySelect([]);

    await applyAlertSpecs({
      orgId: "org-1",
      repoid: "repo-1",
      resources: [
        {
          path: "alerts/high-errors.yaml",
          resource: alert("high-errors", { instanceLabels: ["service"] }),
        },
      ],
    });

    expect(insertValues[0]).toMatchObject([
      { instanceLabelColumns: ["service"] },
    ]);
  });

  it("validates top columns from metadata even when the query returns zero rows", async () => {
    mockedQuerySqlApiWithMeta.mockResolvedValueOnce({
      rows: [],
      columns: ["count"],
    });

    await expect(
      applyAlertSpecs({
        orgId: "org-1",
        repoid: "repo-1",
        resources: [{ path: "missing-column.yaml", resource: alert() }],
      }),
    ).rejects.toThrow(
      /missing-column\.yaml: \$\{top_service\} references column "service"/,
    );
  });

  it("wraps query errors as apply validation errors with path context", async () => {
    mockedQuerySqlApiWithMeta.mockRejectedValueOnce(new Error("syntax error"));

    try {
      await applyAlertSpecs({
        orgId: "org-1",
        repoid: "repo-1",
        resources: [{ path: "query.yaml", resource: alert() }],
      });
      expect.fail("expected query validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyValidationError);
      expect(error).toMatchObject({
        message: expect.stringMatching(
          /query\.yaml: query failed: syntax error/,
        ),
      });
    }
  });
});
