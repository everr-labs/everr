import { describe, expect, it, vi } from "vitest";

// Only so that importing the rule module for its pure halves does not build
// a real database pool. Nothing here answers a query.
vi.mock("@/db/client", () => ({
  db: {},
  pool: {},
  runInTransaction: () => Promise.resolve(),
}));

import type { DefinitionRow } from "@/data/alerting/triage/rules";
import {
  attributeUndelivered,
  channelViews,
  destinationView,
  overrideViews,
} from "./assemble";

function rule(
  overrides: Partial<DefinitionRow> & { channels?: string[] },
): DefinitionRow {
  const { channels, ...rest } = overrides;
  return {
    project: "checkout",
    slug: "api-latency",
    spec: {
      severity: "critical",
      annotations: { "everr.display.name": "API latency" },
      ...(channels ? { notifications: { channels } } : {}),
    },
    ...rest,
  } as DefinitionRow;
}

describe("destinationView", () => {
  it("reads any severity tier as the split mode and fills every tier", () => {
    expect(destinationView({ tiers: { critical: ["#oncall"] } })).toEqual({
      split: true,
      tiers: { all: [], critical: ["#oncall"], warning: [], info: [] },
    });
  });

  it("reads an empty record as unsplit with nothing in it", () => {
    expect(destinationView({ tiers: {} })).toEqual({
      split: false,
      tiers: { all: [], critical: [], warning: [], info: [] },
    });
  });
});

describe("overrideViews", () => {
  it("keeps only the rules that name channels, by display name and path", () => {
    const views = overrideViews([
      rule({ channels: ["#oncall"] }),
      rule({ slug: "plain" }),
      rule({ slug: "empty", channels: [] }),
    ]);
    expect(views).toEqual([
      {
        path: "checkout/api-latency",
        name: "API latency",
        severity: "critical",
        channels: ["#oncall"],
      },
    ]);
  });
});

describe("attributeUndelivered", () => {
  const overrides = overrideViews([
    rule({ slug: "direct", channels: ["#gone"] }),
  ]);

  it("lays a direct rule's count on the rule, whatever its severity", () => {
    const result = attributeUndelivered(
      [{ path: "checkout/direct", severity: "critical", count: 6 }],
      overrides,
      destinationView({ tiers: { critical: ["#oncall"] } }),
    );
    expect(result).toEqual({ tiers: {}, rules: { "checkout/direct": 6 } });
  });

  it("lays a default-path count on the severity tier while split", () => {
    const result = attributeUndelivered(
      [
        { path: "checkout/other", severity: "info", count: 14 },
        { path: "checkout/another", severity: "info", count: 1 },
      ],
      overrides,
      destinationView({ tiers: { critical: ["#oncall"] } }),
    );
    expect(result).toEqual({ tiers: { info: 15 }, rules: {} });
  });

  it("lays every default-path count on the one tier while unsplit", () => {
    const result = attributeUndelivered(
      [
        { path: "checkout/other", severity: "info", count: 2 },
        { path: "checkout/another", severity: "critical", count: 3 },
      ],
      overrides,
      destinationView({ tiers: {} }),
    );
    expect(result).toEqual({ tiers: { all: 5 }, rules: {} });
  });
});

describe("channelViews", () => {
  it("gives a channel nothing delivered to an empty record", () => {
    const [quiet, busy] = channelViews(
      [
        {
          id: "1",
          tenant: "t",
          name: "quiet",
          config: { type: "slack", url: "***" },
        },
        {
          id: "2",
          tenant: "t",
          name: "busy",
          config: { type: "webhook", url: "***" },
        },
      ],
      [
        {
          channel: "busy",
          sent: 41,
          failed: 3,
          lastSentAt: "2026-09-03T10:00:00.000Z",
          lastError: "HTTP 429",
        },
      ],
    );
    expect(quiet).toMatchObject({
      sent: 0,
      failed: 0,
      lastSentAt: null,
      lastError: null,
    });
    expect(busy).toMatchObject({ sent: 41, failed: 3, lastError: "HTTP 429" });
  });
});
