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
    // JSONEachRow renders a Map column natively; no toJSONString round-trip.
    expect(sql).toContain("instance_labels AS labels");
    expect(sql).not.toContain("toJSONString");
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
    const settings = mocks.query.mock.calls[0]?.[3];
    expect(settings).toMatchObject({ max_execution_time: 30 });
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

  it("filters on repoid for a per-rule read, hitting the sort-key prefix", async () => {
    await queryClickHouseAlertEventLog("org-1", {
      ...range,
      previewIds: null,
      slugs: ["default/high-5xx"],
      repoid: "repo-1",
    });

    const [sql, , params] = mocks.query.mock.calls[0];
    expect(sql).toContain("repoid = {repoid:String}");
    expect(params).toMatchObject({ repoid: "repo-1" });
  });

  it("leaves repoid unfiltered for an org-wide read", async () => {
    await queryClickHouseAlertEventLog("org-1", { ...range, previewIds: null });

    const [sql, , params] = mocks.query.mock.calls[0];
    expect(sql).not.toContain("repoid = {repoid:String}");
    expect(params).not.toHaveProperty("repoid");
  });

  // The same overlay the rules list applies: for a repo the branch covers, its
  // events replace live's rather than joining them. A union would have shown
  // the live rule's whole past beside a branch rule minutes old.
  it("replaces a covered repo's live history with the preview's", async () => {
    await queryClickHouseAlertEventLog("org-1", {
      ...range,
      previewIds: ["preview-1", "preview-2"],
      coveredRepoids: ["repo-1"],
      slugs: ["default/high-5xx"],
    });

    const [sql, , params] = mocks.query.mock.calls[0];
    expect(sql).toContain(
      "(preview_id IN {previewIds:Array(UUID)} OR (is_live AND repoid NOT IN {coveredRepoids:Array(String)}))",
    );
    expect(sql).toContain("slug IN {slugs:Array(String)}");
    expect(params).toMatchObject({
      previewIds: ["preview-1", "preview-2"],
      coveredRepoids: ["repo-1"],
      slugs: ["default/high-5xx"],
    });
  });

  // Scoping by definition id already picks a side of the overlay. Asking again
  // would drop every event a preview definition wrote, since none are live,
  // which is what emptied the per-instance feed under `?preview=`.
  it("leaves the live-or-preview question alone when a definition id is given", async () => {
    await queryClickHouseAlertEventLog("org-1", {
      ...range,
      previewIds: ["preview-1"],
      coveredRepoids: ["repo-1"],
      sourceId: "019c3ab6-54d6-7e26-bc76-8cadd67542fb",
    });

    const [sql] = mocks.query.mock.calls[0];
    expect(sql).toContain("alert_definition_id = {sourceId:UUID}");
    expect(sql).not.toContain("is_live");
    expect(sql).not.toContain("preview_id IN");
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
          labels: { host: "web-1" },
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
  // The rank is computed in ClickHouse (GROUP BY + count()), not in Node, so
  // these assert the pushed-down shape and the row-to-result mapping, not a
  // ranking algorithm that no longer lives here.

  it("ranks keys in ClickHouse via arrayJoin(mapKeys(...))", async () => {
    mocks.query.mockResolvedValue([{ key: "service" }, { key: "region" }]);

    await expect(
      queryClickHouseObservedLabelKeys("org-1", { ...range, limit: 2 }),
    ).resolves.toEqual(["service", "region"]);

    const [sql, organizationId, params] = mocks.query.mock.calls[0];
    expect(sql).toContain("arrayJoin(mapKeys(instance_labels)) AS key");
    expect(sql).toContain("GROUP BY key");
    expect(sql).toContain("ORDER BY count() DESC, key ASC");
    expect(sql).toContain("LIMIT {limit:UInt32}");
    expect(organizationId).toBe("org-1");
    expect(params).toMatchObject({ organizationId: "org-1", limit: 2 });
    expect(mocks.query.mock.calls[0]?.[3]).toMatchObject({
      max_execution_time: 30,
    });
  });

  it("ranks values for one key via Map access, excluding rows missing it", async () => {
    mocks.query.mockResolvedValue([{ value: "api" }, { value: "web" }]);

    await expect(
      queryClickHouseObservedLabelValues("org-1", "service", {
        ...range,
        limit: 2,
      }),
    ).resolves.toEqual(["api", "web"]);

    const [sql, , params] = mocks.query.mock.calls[0];
    expect(sql).toContain("instance_labels[{key:String}] AS value");
    expect(sql).toContain("has(instance_labels, {key:String})");
    expect(sql).toContain("GROUP BY value");
    expect(sql).toContain("ORDER BY count() DESC, value ASC");
    expect(params).toMatchObject({ key: "service", limit: 2 });
  });
});
