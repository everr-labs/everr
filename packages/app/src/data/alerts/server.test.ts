import { getRequestHeaders } from "@tanstack/react-start/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { auth } from "@/lib/auth.server";
import { query } from "@/lib/clickhouse";

const mocks = vi.hoisted(() => ({
  returning: vi.fn(),
  onConflictDoUpdate: vi.fn(),
  updateReturning: vi.fn(),
  selectLimit: vi.fn(),
  selectOrderBy: vi.fn(),
  insertValues: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: vi.fn(() => new Headers({ cookie: "session=test" })),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...args: unknown[]) => ({ type: "and", args })),
  desc: vi.fn((value: unknown) => ({ type: "desc", value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ type: "eq", left, right })),
  gt: vi.fn((left: unknown, right: unknown) => ({ type: "gt", left, right })),
  isNull: vi.fn((value: unknown) => ({ type: "isNull", value })),
  lte: vi.fn((left: unknown, right: unknown) => ({ type: "lte", left, right })),
  sql: vi.fn(() => ({ as: vi.fn(() => "active_silence_count") })),
}));

vi.mock("@/db/schema", () => {
  const alertDefinitions = {
    id: "alert_definitions.id",
    organizationId: "alert_definitions.organization_id",
    repoid: "alert_definitions.repoid",
    slug: "alert_definitions.slug",
    evaluationIntervalSeconds: "alert_definitions.evaluation_interval_seconds",
    window: "alert_definitions.window",
    sourceLink: "alert_definitions.source_link",
    configFilePath: "alert_definitions.config_file_path",
    currentState: "alert_definitions.current_state",
    active: "alert_definitions.active",
    validationStatus: "alert_definitions.validation_status",
    lastEvaluationStatus: "alert_definitions.last_evaluation_status",
    lastEvaluationError: "alert_definitions.last_evaluation_error",
    lastEvaluatedAt: "alert_definitions.last_evaluated_at",
    lastFiredAt: "alert_definitions.last_fired_at",
    lastResolvedAt: "alert_definitions.last_resolved_at",
    lastSeenAt: "alert_definitions.last_seen_at",
    lastRowCount: "alert_definitions.last_row_count",
    lastEvidenceSnapshot: "alert_definitions.last_evidence_snapshot",
    firingInstanceCount: "alert_definitions.firing_instance_count",
    rawYaml: "alert_definitions.raw_yaml",
    parsedQuery: "alert_definitions.parsed_query",
    summaryTemplate: "alert_definitions.summary_template",
    descriptionTemplate: "alert_definitions.description_template",
    updatedAt: "alert_definitions.updated_at",
  };
  const alertSettings = {
    organizationId: "alert_settings.organization_id",
    delivery: "alert_settings.delivery",
    updatedAt: "alert_settings.updated_at",
  };
  const alertSilences = {
    id: "alert_silences.id",
    organizationId: "alert_silences.organization_id",
    alertDefinitionId: "alert_silences.alert_definition_id",
    startsAt: "alert_silences.starts_at",
    endsAt: "alert_silences.ends_at",
    reason: "alert_silences.reason",
    matchers: "alert_silences.matchers",
    createdByUserId: "alert_silences.created_by_user_id",
    cancelledAt: "alert_silences.cancelled_at",
    cancelledByUserId: "alert_silences.cancelled_by_user_id",
    updatedAt: "alert_silences.updated_at",
  };
  return { alertDefinitions, alertSettings, alertSilences };
});

vi.mock("@/db/client", () => {
  const selectChain = {
    from: vi.fn(() => selectChain),
    leftJoin: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    orderBy: (...args: unknown[]) => mocks.selectOrderBy(...args),
    limit: (...args: unknown[]) => mocks.selectLimit(...args),
  };
  mocks.selectOrderBy.mockImplementation(() => []);

  const insertChain = {
    values: (...args: unknown[]) => {
      mocks.insertValues(...args);
      return insertChain;
    },
    onConflictDoUpdate: (...args: unknown[]) =>
      mocks.onConflictDoUpdate(...args),
    returning: (...args: unknown[]) => mocks.returning(...args),
  };

  const updateChain = {
    set: (...args: unknown[]) => {
      mocks.updateSet(...args);
      return updateChain;
    },
    where: (...args: unknown[]) => {
      mocks.updateWhere(...args);
      return updateChain;
    },
    returning: (...args: unknown[]) => mocks.updateReturning(...args),
  };

  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
    },
  };
});

import {
  cancelSilence,
  createSilence,
  deactivateAlert,
  listAlertEvents,
  listAlertInstances,
  updateAlertSettings,
} from "./server";

const adminOrg = {
  id: "test_org",
  members: [{ userId: "test_user", role: "admin" }],
};

const memberOrg = {
  id: "test_org",
  members: [{ userId: "test_user", role: "member" }],
};

const alertRow = {
  id: "11111111-1111-1111-1111-111111111111",
  repoid: "owner/repo",
  slug: "build-failures",
  evaluationIntervalSeconds: 300,
  window: "15m",
  sourceLink: "",
  configFilePath: ".everr/alerts.yaml",
  currentState: "firing",
  active: true,
  validationStatus: "valid",
  lastEvaluationStatus: "ok",
  lastEvaluationError: "",
  lastEvaluatedAt: null,
  lastFiredAt: null,
  lastResolvedAt: null,
  lastSeenAt: null,
  lastRowCount: 3,
  lastEvidenceSnapshot: [],
  firingInstanceCount: 1,
  activeSilenceCount: 0,
  rawYaml: "",
  parsedQuery: "SELECT 1",
  summaryTemplate: "",
  descriptionTemplate: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.selectLimit.mockResolvedValue([]);
  mocks.selectOrderBy.mockResolvedValue([]);
  mocks.returning.mockResolvedValue([]);
  mocks.updateReturning.mockResolvedValue([]);
  mocks.onConflictDoUpdate.mockResolvedValue(undefined);
  vi.mocked(auth.api.getFullOrganization).mockResolvedValue(adminOrg as never);
});

describe("updateAlertSettings", () => {
  it("rejects unknown delivery keys", async () => {
    await expect(
      updateAlertSettings({
        data: {
          delivery: {
            telegram: {
              enabled: true,
              chatIds: ["123"],
              botToken: "secret",
            },
          },
        } as never,
      }),
    ).rejects.toThrow();

    expect(db.insert).not.toHaveBeenCalled();
  });

  it("requires an organization admin or owner", async () => {
    vi.mocked(auth.api.getFullOrganization).mockResolvedValueOnce(
      memberOrg as never,
    );

    await expect(
      updateAlertSettings({
        data: {
          delivery: {
            email: { enabled: true, to: ["alerts@example.com"] },
            notifyOnResolved: true,
          },
        },
      }),
    ).rejects.toThrow("Only organization admins can manage alerts");

    expect(getRequestHeaders).toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("normalizes and upserts strict delivery settings", async () => {
    await updateAlertSettings({
      data: {
        delivery: {
          email: { enabled: true, to: ["alerts@example.com"] },
          notifyOnResolved: false,
        },
      },
    });

    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "test_org",
        delivery: {
          email: { enabled: true, to: ["alerts@example.com"] },
          telegram: { enabled: false, chatIds: [] },
          notifyOnResolved: false,
        },
      }),
    );
    expect(mocks.onConflictDoUpdate).toHaveBeenCalled();
  });
});

describe("silences", () => {
  it("persists createdByUserId when creating a silence", async () => {
    mocks.selectLimit.mockResolvedValueOnce([alertRow]);
    mocks.returning.mockResolvedValueOnce([{ id: "silence-1" }]);

    await createSilence({
      data: {
        alertId: alertRow.id,
        endsAt: new Date(Date.now() + 60_000).toISOString(),
        reason: "maintenance",
      },
    });

    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "test_org",
        alertDefinitionId: alertRow.id,
        reason: "maintenance",
        createdByUserId: "test_user",
      }),
    );
  });

  it("persists matchers when creating a silence", async () => {
    mocks.selectLimit.mockResolvedValueOnce([alertRow]);
    mocks.returning.mockResolvedValueOnce([{ id: "silence-1" }]);

    await createSilence({
      data: {
        alertId: alertRow.id,
        endsAt: new Date(Date.now() + 60_000).toISOString(),
        reason: "",
        matchers: [{ label: "route", op: "=", value: "/x" }],
      },
    });

    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        matchers: [{ label: "route", op: "=", value: "/x" }],
      }),
    );
  });

  it("rejects silences with invalid regex matchers", async () => {
    mocks.selectLimit.mockResolvedValueOnce([alertRow]);

    await expect(
      createSilence({
        data: {
          alertId: alertRow.id,
          endsAt: new Date(Date.now() + 60_000).toISOString(),
          reason: "",
          matchers: [{ label: "route", op: "=~", value: "(" }],
        },
      }),
    ).rejects.toThrow(/invalid regex/);

    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it("persists cancelledByUserId when cancelling a silence", async () => {
    mocks.updateReturning.mockResolvedValueOnce([
      { id: "22222222-2222-2222-2222-222222222222" },
    ]);

    await cancelSilence({
      data: { silenceId: "22222222-2222-2222-2222-222222222222" },
    });

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        cancelledByUserId: "test_user",
        cancelledAt: expect.any(Date),
      }),
    );
  });
});

describe("listAlertEvents", () => {
  it("reads canonical ClickHouse alert events with tenant and alert filters", async () => {
    mocks.selectLimit.mockResolvedValueOnce([alertRow]);
    vi.mocked(query).mockResolvedValueOnce([
      {
        eventId: "event-1",
        alertDefinitionId: alertRow.id,
        repoid: alertRow.repoid,
        slug: alertRow.slug,
        eventType: "firing",
        eventTime: "2026-06-10T10:00:00.000Z",
        evaluationScheduledAt: "",
        rowCount: 3,
        evidenceTruncated: 0,
        evidenceJson: "{}",
        deliveryTargetType: "",
        deliveryOutcome: "",
        silenceId: "",
      },
    ]);

    const events = await listAlertEvents({
      data: { alertId: alertRow.id, limit: 25 },
    });

    expect(query).toHaveBeenCalledTimes(1);
    const sql = vi.mocked(query).mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("FROM app.alert_events");
    expect(sql).toContain("organization_id = {organizationId:String}");
    expect(sql).toContain("repoid = {repoid:String}");
    expect(sql).toContain("slug = {slug:String}");
    expect(sql).toContain("alert_definition_id = {alertDefinitionId:String}");
    expect(sql).not.toContain("%3N");
    expect(sql).toContain(
      "substring(formatDateTime(event_time, '%f', 'UTC'), 1, 3)",
    );
    expect(sql).toContain(
      "substring(formatDateTime(evaluation_scheduled_at, '%f', 'UTC'), 1, 3)",
    );
    expect(vi.mocked(query).mock.calls[0]?.[2]).toMatchObject({
      organizationId: "test_org",
      repoid: alertRow.repoid,
      slug: alertRow.slug,
      alertDefinitionId: alertRow.id,
      limit: 25,
    });
    expect(sql).toContain(
      "event_type NOT IN ('instance_fired', 'instance_resolved')",
    );
    expect(events[0]).toMatchObject({
      eventId: "event-1",
      evaluationScheduledAt: null,
      evidenceTruncated: false,
    });
  });
});

describe("listAlertInstances", () => {
  it("derives instance state from latest events and applies silences", async () => {
    mocks.selectLimit.mockResolvedValueOnce([alertRow]);
    mocks.selectOrderBy.mockResolvedValueOnce([
      {
        id: "sil-1",
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 60_000),
        reason: "",
        createdByUserId: "test_user",
        matchers: [{ label: "route", op: "=", value: "/a" }],
      },
    ]);
    vi.mocked(query).mockResolvedValueOnce([
      {
        fingerprint: "f-a",
        lastEventType: "instance_fired",
        labelsJson: `{"route":"/a"}`,
        lastFiredEvidenceJson: `{"route":"/a","count":5}`,
        lastFiredAt: "2026-06-11T09:00:00.000Z",
        lastResolvedAt: "",
      },
      {
        fingerprint: "f-b",
        lastEventType: "instance_resolved",
        labelsJson: `{"route":"/b"}`,
        lastFiredEvidenceJson: `{"route":"/b","count":2}`,
        lastFiredAt: "2026-06-11T08:00:00.000Z",
        lastResolvedAt: "2026-06-11T09:30:00.000Z",
      },
    ]);

    const instances = await listAlertInstances({
      data: { alertId: alertRow.id },
    });

    const sql = vi.mocked(query).mock.calls[0]?.[0] ?? "";
    expect(sql).toContain("GROUP BY instance_fingerprint");
    expect(sql).toContain(
      "event_type IN ('instance_fired', 'instance_resolved')",
    );
    expect(instances).toEqual([
      {
        fingerprint: "f-a",
        labels: { route: "/a" },
        state: "firing",
        lastFiredAt: "2026-06-11T09:00:00.000Z",
        lastResolvedAt: null,
        lastRow: { route: "/a", count: 5 },
        silenced: true,
      },
      {
        fingerprint: "f-b",
        labels: { route: "/b" },
        state: "resolved",
        lastFiredAt: "2026-06-11T08:00:00.000Z",
        lastResolvedAt: "2026-06-11T09:30:00.000Z",
        lastRow: { route: "/b", count: 2 },
        silenced: false,
      },
    ]);
  });
});

describe("deactivateAlert", () => {
  it("clears scheduling state when deactivating an alert", async () => {
    mocks.updateReturning.mockResolvedValueOnce([{ id: alertRow.id }]);

    await deactivateAlert({ data: { alertId: alertRow.id } });

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        active: false,
        nextEvaluationAt: null,
      }),
    );
  });
});
