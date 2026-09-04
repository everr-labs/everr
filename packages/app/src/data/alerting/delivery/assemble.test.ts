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
  channelViews,
  deriveGaps,
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

const channel = (name: string) => ({
  id: name,
  tenant: "t",
  name,
  config: { type: "slack" as const, url: "***" },
});

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

describe("channelViews", () => {
  const overrides = overrideViews([rule({ channels: ["pager"] })]);

  it("names the tiers and rules that reach each channel, worst tier first", () => {
    const [oncall, pager, quiet] = channelViews(
      [channel("#oncall"), channel("pager"), channel("quiet")],
      destinationView({
        tiers: { warning: ["#oncall"], critical: ["#oncall", "pager"] },
      }),
      overrides,
    );
    expect(oncall).toMatchObject({ tiers: ["critical", "warning"], rules: [] });
    expect(pager).toMatchObject({
      tiers: ["critical"],
      rules: ["checkout/api-latency"],
    });
    expect(quiet).toMatchObject({ tiers: [], rules: [] });
  });

  it("reads an unsplit destination as the one tier", () => {
    const [oncall] = channelViews(
      [channel("#oncall")],
      destinationView({ tiers: { all: ["#oncall"] } }),
      [],
    );
    expect(oncall?.tiers).toEqual(["all"]);
  });
});

describe("deriveGaps", () => {
  const overrides = overrideViews([
    rule({ slug: "direct", channels: ["#gone", "#oncall"] }),
  ]);
  const known = ["#oncall"];

  it("lays a direct rule's count on the missing channel it names", () => {
    const gaps = deriveGaps(
      [{ path: "checkout/direct", severity: "critical", count: 6 }],
      overrides,
      destinationView({
        tiers: {
          critical: ["#oncall"],
          warning: ["#oncall"],
          info: ["#oncall"],
        },
      }),
      known,
    );
    expect(gaps).toEqual([
      {
        kind: "missing-channel",
        rule: { path: "checkout/direct", name: "API latency" },
        channel: "#gone",
        count: 6,
      },
    ]);
  });

  it("opens a gap per empty severity tier while split, with its count", () => {
    const gaps = deriveGaps(
      [
        { path: "checkout/other", severity: "info", count: 14 },
        { path: "checkout/another", severity: "info", count: 1 },
      ],
      [],
      destinationView({ tiers: { critical: ["#oncall"] } }),
      known,
    );
    expect(gaps).toEqual([
      { kind: "tier", tier: "warning", count: 0 },
      { kind: "tier", tier: "info", count: 15 },
    ]);
  });

  it("opens one gap for the whole default while unsplit and empty", () => {
    const gaps = deriveGaps(
      [
        { path: "checkout/other", severity: "info", count: 2 },
        { path: "checkout/another", severity: "critical", count: 3 },
      ],
      [],
      destinationView({ tiers: {} }),
      [],
    );
    expect(gaps).toEqual([{ kind: "tier", tier: "all", count: 5 }]);
  });

  it("drops a count whose tier has since been filled", () => {
    const gaps = deriveGaps(
      [{ path: "checkout/other", severity: "info", count: 2 }],
      [],
      destinationView({ tiers: { all: ["#oncall"] } }),
      known,
    );
    expect(gaps).toEqual([]);
  });
});
