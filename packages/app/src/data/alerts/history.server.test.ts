import { beforeEach, describe, expect, it, vi } from "vitest";

type Condition = {
  op: string;
  args: unknown[];
};

const mocks = vi.hoisted(() => ({
  conditions: [] as unknown[],
  rows: [] as Record<string, unknown>[],
  targetRows: [] as Record<string, unknown>[],
}));

vi.mock("drizzle-orm", () => {
  const condition =
    (op: string) =>
    (...args: unknown[]): Condition => ({
      op,
      args,
    });
  return {
    and: condition("and"),
    desc: condition("desc"),
    eq: condition("eq"),
    gte: condition("gte"),
    inArray: condition("inArray"),
    isNull: condition("isNull"),
    lte: condition("lte"),
    or: condition("or"),
  };
});

vi.mock("@/db/schema", () => ({
  alertDeliveries: {
    organizationId: "delivery_organization_id",
    dedupKey: "dedup_key",
    channelId: "delivery_channel_id",
    channelName: "channel_name",
    status: "delivery_status",
  },
  alertDeliveryEvents: {
    organizationId: "delivery_event_organization_id",
    deliveryDedupKey: "delivery_dedup_key",
    eventId: "delivery_event_id",
  },
  alertEvents: {
    id: "event_id",
    organizationId: "organization_id",
    previewId: "preview_id",
    occurredAt: "occurred_at",
    suppressed: "suppressed",
    instanceFingerprint: "instance_fingerprint",
    slug: "slug",
    instanceLabels: "instance_labels",
  },
}));

vi.mock("@/db/client", () => {
  const select = vi.fn((selection?: unknown) => {
    const isTargetQuery = selection !== undefined;
    const chain = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn((conditions: unknown) => {
        mocks.conditions.push(conditions);
        return isTargetQuery ? Promise.resolve(mocks.targetRows) : chain;
      }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve(mocks.rows)),
    };
    return chain;
  });
  return { db: { select } };
});

import { queryPostgresAlertEventLog } from "./history.server";

function leafConditions(condition: unknown): Condition[] {
  if (
    typeof condition !== "object" ||
    condition === null ||
    !("op" in condition) ||
    !("args" in condition)
  ) {
    return [];
  }
  const node = condition as Condition;
  return [node, ...node.args.flatMap(leafConditions)];
}

const range = {
  limit: 100,
  fromISO: "2026-06-01T00:00:00Z",
  toISO: "2026-06-16T00:00:00Z",
};

beforeEach(() => {
  mocks.conditions = [];
  mocks.rows = [];
  mocks.targetRows = [];
});

describe("queryPostgresAlertEventLog", () => {
  it("selects only live, unsuppressed events without a preview", async () => {
    await queryPostgresAlertEventLog("org-1", {
      ...range,
      previewIds: null,
    });

    const conditions = leafConditions(mocks.conditions[0]);
    expect(conditions).toContainEqual({ op: "isNull", args: ["preview_id"] });
    expect(conditions).toContainEqual({
      op: "eq",
      args: ["suppressed", false],
    });
    expect(conditions).toContainEqual({
      op: "eq",
      args: ["organization_id", "org-1"],
    });
  });

  it("overlays only the selected Preview ids on live history", async () => {
    await queryPostgresAlertEventLog("org-1", {
      ...range,
      previewIds: ["preview-1", "preview-2"],
    });

    const conditions = leafConditions(mocks.conditions[0]);
    expect(conditions).toContainEqual({ op: "isNull", args: ["preview_id"] });
    expect(conditions).toContainEqual({
      op: "inArray",
      args: ["preview_id", ["preview-1", "preview-2"]],
    });
    expect(conditions).not.toContainEqual({
      op: "eq",
      args: ["suppressed", false],
    });
  });

  it("maps durable event rows to the public history shape", async () => {
    mocks.rows = [
      {
        id: "event-1",
        occurredAt: new Date("2026-06-10T00:00:00Z"),
        eventType: "instance_fired",
        slug: "default/high-5xx",
        instanceFingerprint: "fp-1",
        instanceLabels: { host: "web-1" },
        severity: "critical",
        suppressed: false,
        silenced: false,
        inhibited: false,
        evidence: { value: 42 },
        evidenceTruncated: false,
      },
    ];
    mocks.targetRows = [{ eventId: "event-1", channelName: "on-call" }];

    await expect(
      queryPostgresAlertEventLog("org-1", {
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
        silenced: false,
        inhibited: false,
        deliveryTargets: ["on-call"],
        evidence: { value: 42 },
        evidenceTruncated: false,
      },
    ]);
  });
});
