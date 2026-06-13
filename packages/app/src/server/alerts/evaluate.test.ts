import { beforeEach, describe, expect, it, vi } from "vitest";

const sqlApi = vi.fn();
const insertEvents = vi.fn();
vi.mock("@/lib/clickhouse", () => ({
  querySqlApiWithMeta: (...args: unknown[]) => sqlApi(...args),
  // The real ./events module runs; only its ClickHouse write is stubbed, so
  // the spy receives the event rows directly.
  insertAdminRows: (_table: string, rows: unknown[]) => insertEvents(rows),
}));

const deliver = vi.fn();
vi.mock("./delivery", () => ({
  enqueueAlertNotification: (...args: unknown[]) => deliver(...args),
}));

const fetchFiring = vi.fn();
vi.mock("./instances", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./instances")>();
  return {
    ...actual,
    fetchFiringInstances: (...args: unknown[]) => fetchFiring(...args),
  };
});

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
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  serverLogger: { error: vi.fn(), warn: vi.fn() },
}));

import { serverLogger } from "@/telemetry/logger";
import { evaluateAlert } from "./evaluate";
import { instanceFingerprint } from "./instances";

const alertDefinitionId = "11111111-1111-4111-8111-111111111111";

const baseDef = {
  id: alertDefinitionId,
  organizationId: "org-1",
  repoid: "r1",
  slug: "high-5xx",
  active: true,
  parsedQuery:
    "SELECT route FROM logs WHERE TimestampTime >= now() - INTERVAL 5 MINUTE",
  summaryTemplate: `\${row_count} bad`,
  descriptionTemplate: "",
  currentState: "resolved",
  instanceLabelColumns: [],
  firingInstanceCount: 0,
};

const fp = (route: string) => instanceFingerprint({ route });
const firing = (route: string) => ({
  fingerprint: fp(route),
  labels: { route },
});

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  deliver.mockResolvedValue({
    deliveryTargets: { email: ["a@example.com"] },
    silenceId: "",
  });
  insertEvents.mockResolvedValue(undefined);
  fetchFiring.mockResolvedValue([]);
});

describe("evaluateAlert", () => {
  it("fires new instances and notifies", async () => {
    definitionRows.mockReturnValue([baseDef]);
    sqlApi.mockResolvedValue({ rows: [{ route: "/x" }], columns: ["route"] });

    await evaluateAlert({
      alertDefinitionId,
      scheduledFor: "2026-06-10T12:00:00.000Z",
    });

    const inserted = insertEvents.mock.calls[0][0] as Record<string, unknown>[];
    expect(inserted.map((e) => e.event_type)).toEqual([
      "instance_fired",
      "firing",
    ]);
    expect(inserted[0]).toMatchObject({ instance_fingerprint: fp("/x") });
    expect(inserted[1]).toMatchObject({
      delivery_targets: { email: ["a@example.com"] },
      silence_id: "",
    });
    expect(
      updates.some(
        (u) => (u as { currentState?: string }).currentState === "firing",
      ),
    ).toBe(true);
    expect(
      updates.some(
        (u) =>
          (u as { firingInstanceCount?: number }).firingInstanceCount === 1,
      ),
    ).toBe(true);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "firing", firingCount: 1 }),
      expect.any(Date),
    );
  });

  it("logs event insert failures without blocking notifications", async () => {
    definitionRows.mockReturnValue([baseDef]);
    sqlApi.mockResolvedValue({ rows: [{ route: "/x" }], columns: ["route"] });
    insertEvents.mockRejectedValueOnce(new Error("readonly"));

    await evaluateAlert({
      alertDefinitionId,
      scheduledFor: "2026-06-10T12:00:00.000Z",
    });

    expect(serverLogger.error).toHaveBeenCalledWith(
      "alerts.evaluate.event_insert_failed",
      expect.objectContaining({
        "alert.definition_id": alertDefinitionId,
        "exception.message": "readonly",
        "error.handled": true,
      }),
    );
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "firing", firingCount: 1 }),
      expect.any(Date),
    );
  });

  it("re-notifies when a new instance joins an already firing rule", async () => {
    definitionRows.mockReturnValue([{ ...baseDef, currentState: "firing" }]);
    fetchFiring.mockResolvedValue([firing("/x")]);
    sqlApi.mockResolvedValue({
      rows: [{ route: "/x" }, { route: "/y" }],
      columns: ["route"],
    });

    await evaluateAlert({
      alertDefinitionId,
      scheduledFor: "2026-06-10T12:00:00.000Z",
    });

    const inserted = insertEvents.mock.calls[0][0] as Record<string, unknown>[];
    expect(inserted.map((e) => e.event_type)).toEqual([
      "instance_fired",
      "firing",
    ]);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "firing",
        firingCount: 2,
        instances: [expect.objectContaining({ fingerprint: fp("/y") })],
      }),
      expect.any(Date),
    );
  });

  it("does not notify or write events when the firing set is unchanged", async () => {
    definitionRows.mockReturnValue([{ ...baseDef, currentState: "firing" }]);
    fetchFiring.mockResolvedValue([firing("/x")]);
    sqlApi.mockResolvedValue({ rows: [{ route: "/x" }], columns: ["route"] });

    await evaluateAlert({
      alertDefinitionId,
      scheduledFor: "2026-06-10T12:00:00.000Z",
    });

    expect(insertEvents).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(updates.length).toBeGreaterThan(0);
  });

  it("resolves instances and the rule when the result empties", async () => {
    definitionRows.mockReturnValue([{ ...baseDef, currentState: "firing" }]);
    fetchFiring.mockResolvedValue([firing("/x")]);
    sqlApi.mockResolvedValue({ rows: [], columns: ["route"] });

    await evaluateAlert({
      alertDefinitionId,
      scheduledFor: "2026-06-10T12:00:00.000Z",
    });

    const inserted = insertEvents.mock.calls[0][0] as Record<string, unknown>[];
    expect(inserted.map((e) => e.event_type)).toEqual([
      "instance_resolved",
      "resolved",
    ]);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "resolved", firingCount: 0 }),
      expect.any(Date),
    );
  });

  it("resolves part of the set without a rule-level resolved event", async () => {
    definitionRows.mockReturnValue([{ ...baseDef, currentState: "firing" }]);
    fetchFiring.mockResolvedValue([firing("/x"), firing("/y")]);
    sqlApi.mockResolvedValue({ rows: [{ route: "/x" }], columns: ["route"] });

    await evaluateAlert({
      alertDefinitionId,
      scheduledFor: "2026-06-10T12:00:00.000Z",
    });

    const inserted = insertEvents.mock.calls[0][0] as Record<string, unknown>[];
    expect(inserted.map((e) => e.event_type)).toEqual([
      "instance_resolved",
      "partial_resolved",
    ]);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "partial_resolved",
        firingCount: 1,
        instances: [
          expect.objectContaining({
            fingerprint: fp("/y"),
            labels: { route: "/y" },
          }),
        ],
      }),
      expect.any(Date),
    );
  });

  it("records evaluation_failed when the firing-set read fails", async () => {
    definitionRows.mockReturnValue([{ ...baseDef, currentState: "firing" }]);
    sqlApi.mockResolvedValue({ rows: [{ route: "/x" }], columns: ["route"] });
    fetchFiring.mockRejectedValue(new Error("ch down"));

    await evaluateAlert({
      alertDefinitionId,
      scheduledFor: "2026-06-10T12:00:00.000Z",
    });

    expect(
      updates.some(
        (u) => (u as { currentState?: string }).currentState !== undefined,
      ),
    ).toBe(false);
    expect(insertEvents).toHaveBeenCalledWith([
      expect.objectContaining({ event_type: "evaluation_failed" }),
    ]);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("records evaluation_failed without changing state when the query fails", async () => {
    definitionRows.mockReturnValue([{ ...baseDef, currentState: "firing" }]);
    sqlApi.mockRejectedValue(new Error("boom"));

    await evaluateAlert({
      alertDefinitionId,
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

  it("logs the original evaluation failure when event insertion also fails", async () => {
    definitionRows.mockReturnValue([{ ...baseDef, currentState: "firing" }]);
    sqlApi.mockRejectedValue(new Error("query down"));
    insertEvents.mockRejectedValueOnce(new Error("readonly"));

    await evaluateAlert({
      alertDefinitionId,
      scheduledFor: "2026-06-10T12:00:00.000Z",
    });

    expect(serverLogger.error).toHaveBeenCalledWith(
      "alerts.evaluate.query_failed",
      expect.objectContaining({
        "alert.definition_id": alertDefinitionId,
        "exception.message": "query down",
        "error.handled": true,
      }),
    );
    expect(serverLogger.error).toHaveBeenCalledWith(
      "alerts.evaluate.event_insert_failed",
      expect.objectContaining({
        "alert.definition_id": alertDefinitionId,
        "exception.message": "readonly",
        "error.handled": true,
      }),
    );
    expect(deliver).not.toHaveBeenCalled();
  });

  it("no-ops when the definition is inactive", async () => {
    definitionRows.mockReturnValue([{ ...baseDef, active: false }]);

    await evaluateAlert({
      alertDefinitionId,
      scheduledFor: "2026-06-10T12:00:00.000Z",
    });

    expect(sqlApi).not.toHaveBeenCalled();
  });

  it("drops malformed stale jobs before querying Postgres", async () => {
    await evaluateAlert({
      alertDefinitionId: "1",
      scheduledFor: "2026-06-10T12:00:00.000Z",
    });

    expect(definitionRows).not.toHaveBeenCalled();
    expect(sqlApi).not.toHaveBeenCalled();
    expect(insertEvents).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });
});
