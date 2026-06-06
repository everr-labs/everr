import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db/client", () => ({
  db: {},
}));

vi.mock("@/db/notify", () => ({
  notifyAlertUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/clickhouse", () => ({
  querySqlApi: vi.fn(),
}));

vi.mock("./repository", () => ({
  getAlertDefinitionForEvaluation: vi.fn(),
  updateAlertState: vi.fn(),
  createAlertEvent: vi.fn(),
}));

vi.mock("./routing", () => ({
  resolveRoutingRecipients: vi.fn(),
}));

import { notifyAlertUpdate } from "@/db/notify";
import { querySqlApi } from "@/lib/clickhouse";
import { evaluateAlertJob } from "./evaluator";
import {
  createAlertEvent,
  getAlertDefinitionForEvaluation,
  updateAlertState,
} from "./repository";
import { resolveRoutingRecipients } from "./routing";

const mockedQuerySqlApi = vi.mocked(querySqlApi);
const mockedNotifyAlertUpdate = vi.mocked(notifyAlertUpdate);
const mockedGetDefinition = vi.mocked(getAlertDefinitionForEvaluation);
const mockedUpdateState = vi.mocked(updateAlertState);
const mockedCreateEvent = vi.mocked(createAlertEvent);
const mockedResolveRecipients = vi.mocked(resolveRoutingRecipients);

const scheduledFor = "2026-06-06T10:00:00.000Z";
const occurredAt = new Date("2026-06-06T10:00:05.000Z");

function activeDefinition(overrides = {}) {
  return {
    id: 42,
    organizationId: "org1",
    service: "api",
    name: "high-5xx-routes",
    severity: "critical" as const,
    routingSlug: "admins",
    evaluationIntervalSeconds: 60,
    windowSeconds: 300,
    active: true,
    query:
      "SELECT * FROM traces WHERE Timestamp >= now() - INTERVAL {{ window }}",
    summaryTemplate: "{{ rows.length }} routes failing in {{ service }}",
    descriptionTemplate: "Top route: {{ rows.0.route }}",
    sourceUrl: "https://github.com/acme/repo/blob/main/alerts.yaml",
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    id: 100,
    alertDefinitionId: 42,
    organizationId: "org1",
    type: "firing" as const,
    evaluationScheduledFor: new Date(scheduledFor),
    occurredAt,
    summary: "2 routes failing in api",
    description: "Top route: /api",
    rowCount: 2,
    evidence: [{ route: "/api" }],
    evidenceTruncated: false,
    errorMessage: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetDefinition.mockResolvedValue(activeDefinition());
  mockedResolveRecipients.mockResolvedValue(["u1", "u2"]);
  mockedCreateEvent.mockResolvedValue(event());
});

describe("evaluateAlertJob", () => {
  it("creates a firing event from a non-firing state with matching rows", async () => {
    mockedQuerySqlApi.mockResolvedValueOnce([
      { route: "/api", error_count: 12 },
      { route: "/admin", error_count: 11 },
    ]);
    mockedUpdateState.mockResolvedValueOnce({
      eventType: "firing",
      previousStatus: "resolved",
      currentStatus: "firing",
    });

    await evaluateAlertJob({ alertDefinitionId: 42, scheduledFor });

    expect(mockedQuerySqlApi).toHaveBeenCalledWith(
      expect.stringContaining("INTERVAL 5 MINUTE"),
      "org1",
    );
    expect(mockedUpdateState).toHaveBeenCalledWith(
      expect.objectContaining({
        alertDefinitionId: 42,
        organizationId: "org1",
        rowCount: 2,
        evidence: [
          { route: "/api", error_count: 12 },
          { route: "/admin", error_count: 11 },
        ],
        evidenceTruncated: false,
      }),
    );
    expect(mockedCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "firing",
        summary: "2 routes failing in api",
        description: "Top route: /api",
      }),
    );
    expect(mockedNotifyAlertUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        kind: "alert",
        tenantId: "org1",
        recipientUserIds: ["u1", "u2"],
        alertDefinitionId: 42,
        alertEventId: 100,
        status: "firing",
      }),
    );
  });

  it("does not create duplicate firing events while already firing", async () => {
    mockedQuerySqlApi.mockResolvedValueOnce([{ route: "/api" }]);
    mockedUpdateState.mockResolvedValueOnce({
      eventType: null,
      previousStatus: "firing",
      currentStatus: "firing",
    });

    await evaluateAlertJob({ alertDefinitionId: 42, scheduledFor });

    expect(mockedCreateEvent).not.toHaveBeenCalled();
    expect(mockedNotifyAlertUpdate).not.toHaveBeenCalled();
  });

  it("creates a resolved event when a firing alert has no rows", async () => {
    mockedQuerySqlApi.mockResolvedValueOnce([]);
    mockedUpdateState.mockResolvedValueOnce({
      eventType: "resolved",
      previousStatus: "firing",
      currentStatus: "resolved",
    });
    mockedCreateEvent.mockResolvedValueOnce(
      event({
        type: "resolved",
        summary: "0 routes failing in api",
        description: "Top route: ",
        rowCount: 0,
        evidence: [],
      }),
    );

    await evaluateAlertJob({ alertDefinitionId: 42, scheduledFor });

    expect(mockedCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "resolved",
        rowCount: 0,
        evidence: [],
      }),
    );
  });

  it("records evaluation failures without changing firing or resolved state", async () => {
    mockedQuerySqlApi.mockRejectedValueOnce(new Error("ClickHouse timeout"));
    mockedUpdateState.mockResolvedValueOnce({
      eventType: "evaluation_failed",
      previousStatus: "firing",
      currentStatus: "firing",
    });
    mockedCreateEvent.mockResolvedValueOnce(
      event({
        type: "evaluation_failed",
        summary: "Alert evaluation failed for api/high-5xx-routes",
        description: "ClickHouse timeout",
        rowCount: 0,
        evidence: [],
        errorMessage: "ClickHouse timeout",
      }),
    );

    await evaluateAlertJob({ alertDefinitionId: 42, scheduledFor });

    expect(mockedUpdateState).toHaveBeenCalledWith(
      expect.objectContaining({
        errorMessage: "ClickHouse timeout",
        rowCount: 0,
        evidence: [],
      }),
    );
    expect(mockedCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "evaluation_failed",
        errorMessage: "ClickHouse timeout",
      }),
    );
  });

  it("exits without querying when the definition is inactive or missing", async () => {
    mockedGetDefinition.mockResolvedValueOnce(
      activeDefinition({ active: false }),
    );

    await evaluateAlertJob({ alertDefinitionId: 42, scheduledFor });

    expect(mockedQuerySqlApi).not.toHaveBeenCalled();

    mockedGetDefinition.mockResolvedValueOnce(null);

    await evaluateAlertJob({ alertDefinitionId: 42, scheduledFor });

    expect(mockedQuerySqlApi).not.toHaveBeenCalled();
  });
});
