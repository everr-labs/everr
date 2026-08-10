import { beforeEach, describe, expect, it, vi } from "vitest";

// No PostgreSQL mock on purpose: the history read answers entirely from
// ClickHouse, so any reintroduced cross-store join would fail here rather than
// pass silently.
const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/lib/clickhouse", () => ({ query: mocks.query }));

import {
  queryClickHouseAlertEventLog,
  queryClickHouseObservedLabelKeys,
  queryClickHouseObservedLabelValues,
} from "./repository.server";

const range = {
  limit: 100,
  from: new Date("2026-06-01T00:00:00Z"),
  to: new Date("2026-06-16T00:00:00Z"),
};

beforeEach(() => {
  mocks.query.mockReset().mockResolvedValue([]);
});

describe("queryClickHouseAlertEventLog", () => {
  it("selects live transition history", async () => {
    await queryClickHouseAlertEventLog("org-1", {
      ...range,
      previewIds: null,
      sourceId: "019c3ab6-54d6-7e26-bc76-8cadd67542fb",
      fingerprint: "fp-1",
    });

    const [sql, organizationId, params] = mocks.query.mock.calls[0];
    expect(sql).toContain("FROM app.alert_events");
    expect(sql).toContain(
      "event_type IN ('instance_pending', 'instance_fired', 'instance_resolved', 'instance_closed')",
    );
    expect(sql).toContain("is_live");
    expect(sql).toContain("alert_definition_id = {sourceId:UUID}");
    expect(sql).toContain("instance_fingerprint = {fingerprint:String}");
    expect(organizationId).toBe("org-1");
    expect(params).toMatchObject({
      organizationId: "org-1",
      sourceId: "019c3ab6-54d6-7e26-bc76-8cadd67542fb",
      fingerprint: "fp-1",
      limit: 100,
      from: "2026-06-01 00:00:00.000",
      to: "2026-06-16 00:00:00.000",
    });
  });

  it("does not filter out a muted live rule's own history", async () => {
    // rule_muted marks a rule that never notifies; it must not also hide
    // that rule's history from its own detail page (rule_muted AS
    // suppressed is returned for the UI to render, not to filter on).
    await queryClickHouseAlertEventLog("org-1", { ...range, previewIds: null });
    const [liveSql] = mocks.query.mock.calls[0];
    expect(liveSql).not.toContain("rule_muted = false");

    mocks.query.mockClear();
    await queryClickHouseAlertEventLog("org-1", { ...range, previewIds: [] });
    const [emptyPreviewSql] = mocks.query.mock.calls[0];
    // The null and empty-array preview branches both mean "live only" and
    // must filter identically.
    expect(emptyPreviewSql).toBe(liveSql);
  });

  it("overlays selected Preview ids on live history", async () => {
    await queryClickHouseAlertEventLog("org-1", {
      ...range,
      previewIds: ["preview-1", "preview-2"],
      slugs: ["default/high-5xx"],
    });

    const [sql, , params] = mocks.query.mock.calls[0];
    expect(sql).toContain(
      "(is_live OR preview_id IN {previewIds:Array(UUID)})",
    );
    expect(sql).toContain("slug IN {slugs:Array(String)}");
    expect(params).toMatchObject({
      previewIds: ["preview-1", "preview-2"],
      slugs: ["default/high-5xx"],
    });
  });

  it("folds suppression and delivery outcomes onto their transition", async () => {
    mocks.query
      .mockResolvedValueOnce([
        {
          eventId: "019c3ab6-54d6-7e26-bc76-8cadd67542fb",
          timestamp: "2026-06-10T00:00:00.000Z",
          eventType: "instance_fired",
          slug: "default/high-5xx",
          instanceFingerprint: "fp-1",
          labelsJson: '{"host":"web-1"}',
          severity: "critical",
          suppressed: 0,
          reason: "",
          evidenceJson: '{"value":42}',
          evidenceTruncated: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          eventId: "019c3ab6-54d6-7e26-bc76-8cadd67542fb",
          silenced: 1,
          inhibited: 0,
          deliveryTargets: ["on-call"],
        },
      ]);

    await expect(
      queryClickHouseAlertEventLog("org-1", {
        ...range,
        previewIds: null,
      }),
    ).resolves.toEqual([
      {
        timestamp: "2026-06-10T00:00:00.000Z",
        eventType: "instance_fired",
        slug: "default/high-5xx",
        instanceFingerprint: "fp-1",
        labels: { host: "web-1" },
        severity: "critical",
        suppressed: false,
        silenced: true,
        inhibited: false,
        reason: "",
        deliveryTargets: ["on-call"],
        evidence: { value: 42 },
        evidenceTruncated: false,
      },
    ]);

    const outcomeSql = mocks.query.mock.calls[1]?.[0] as string;
    expect(outcomeSql).toContain(
      "notification_event_id IN {eventIds:Array(UUID)}",
    );
    expect(outcomeSql).toContain(
      "event_type IN ('notification_suppressed', 'delivery_succeeded', 'delivery_failed')",
    );
  });
});

describe("observed label suggestions", () => {
  it("ranks keys and values from ClickHouse transition labels", async () => {
    mocks.query.mockResolvedValue([
      { labelsJson: '{"service":"api","region":"eu"}' },
      { labelsJson: '{"service":"api"}' },
      { labelsJson: '{"service":"web"}' },
    ]);

    await expect(
      queryClickHouseObservedLabelKeys("org-1", { ...range, limit: 2 }),
    ).resolves.toEqual(["service", "region"]);
    await expect(
      queryClickHouseObservedLabelValues("org-1", "service", {
        ...range,
        limit: 2,
      }),
    ).resolves.toEqual(["api", "web"]);
  });
});
