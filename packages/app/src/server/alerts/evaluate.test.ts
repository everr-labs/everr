import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlApi = vi.fn();
const insertEvents = vi.fn();
vi.mock("@/lib/clickhouse", () => ({
  querySqlApiWithMeta: (...args: unknown[]) => sqlApi(...args),
  insertAlertEvents: (...args: unknown[]) => insertEvents(...args),
}));

const deliver = vi.fn();
vi.mock("./delivery", () => ({
  deliverAlertNotification: (...args: unknown[]) => deliver(...args),
}));

const definitionRows = vi.fn();
const updates: unknown[] = [];
vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(definitionRows()),
        }),
      }),
    }),
    update: () => ({
      set: (value: unknown) => ({
        where: () => {
          updates.push(value);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

vi.mock("@/telemetry/logger", () => ({
  exceptionAttributes: (error: unknown) => ({
    "exception.message": error instanceof Error ? error.message : String(error),
  }),
  serverLogger: { error: vi.fn() },
}));

import { evaluateAlert } from "./evaluate";

const baseDef = {
  id: "a1",
  organizationId: "org-1",
  repoid: "r1",
  slug: "high-5xx",
  active: true,
  window: "5m",
  parsedQuery: `SELECT route FROM logs WHERE TimestampTime >= now() - INTERVAL \${window}`,
  summaryTemplate: `\${row_count} bad`,
  descriptionTemplate: "",
  currentState: "resolved",
};

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  deliver.mockResolvedValue(undefined);
  insertEvents.mockResolvedValue(undefined);
});

describe("evaluateAlert", () => {
  it("fires on non-empty result", async () => {
    definitionRows.mockReturnValue([baseDef]);
    sqlApi.mockResolvedValue({ rows: [{ route: "/x" }], columns: ["route"] });

    await evaluateAlert({
      alertDefinitionId: "a1",
      scheduledFor: "2026-06-10T12:00:00.000Z",
    });

    expect(
      updates.some(
        (u) => (u as { currentState?: string }).currentState === "firing",
      ),
    ).toBe(true);
    expect(insertEvents).toHaveBeenCalledWith([
      expect.objectContaining({ event_type: "firing", row_count: 1 }),
    ]);
    expect(deliver).toHaveBeenCalledOnce();
  });

  it("updates evidence for repeated firing without a new event or delivery", async () => {
    definitionRows.mockReturnValue([{ ...baseDef, currentState: "firing" }]);
    sqlApi.mockResolvedValue({ rows: [{ route: "/x" }], columns: ["route"] });

    await evaluateAlert({
      alertDefinitionId: "a1",
      scheduledFor: "2026-06-10T12:00:00.000Z",
    });

    expect(insertEvents).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(updates.length).toBeGreaterThan(0);
  });

  it("resolves from firing on empty result", async () => {
    definitionRows.mockReturnValue([{ ...baseDef, currentState: "firing" }]);
    sqlApi.mockResolvedValue({ rows: [], columns: ["route"] });

    await evaluateAlert({
      alertDefinitionId: "a1",
      scheduledFor: "2026-06-10T12:00:00.000Z",
    });

    expect(insertEvents).toHaveBeenCalledWith([
      expect.objectContaining({ event_type: "resolved" }),
    ]);
  });

  it("records evaluation_failed without changing state when the query fails", async () => {
    definitionRows.mockReturnValue([{ ...baseDef, currentState: "firing" }]);
    sqlApi.mockRejectedValue(new Error("boom"));

    await evaluateAlert({
      alertDefinitionId: "a1",
      scheduledFor: "2026-06-10T12:00:00.000Z",
    });

    expect(
      updates.some(
        (u) => (u as { currentState?: string }).currentState !== undefined,
      ),
    ).toBe(false);
    expect(
      updates.some(
        (u) =>
          (u as { lastEvaluationError?: string }).lastEvaluationError ===
          "boom",
      ),
    ).toBe(true);
    expect(insertEvents).toHaveBeenCalledWith([
      expect.objectContaining({ event_type: "evaluation_failed" }),
    ]);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("no-ops when the definition is inactive", async () => {
    definitionRows.mockReturnValue([{ ...baseDef, active: false }]);

    await evaluateAlert({
      alertDefinitionId: "a1",
      scheduledFor: "2026-06-10T12:00:00.000Z",
    });

    expect(sqlApi).not.toHaveBeenCalled();
  });
});
