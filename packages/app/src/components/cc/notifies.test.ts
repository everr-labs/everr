import { describe, expect, it } from "vitest";
import type { CcRoute } from "@/data/cc/types";
import { computeNotifiesChannels, joinWithAnd } from "./notifies";

function ccRoute(overrides: Partial<CcRoute> = {}): CcRoute {
  return {
    id: "route-1",
    tenant: "t1",
    matchers: [],
    receiver: "oncall",
    continue: false,
    priority: 0,
    group_by: null,
    group_wait_secs: null,
    group_interval_secs: null,
    repeat_interval_secs: null,
    ...overrides,
  };
}

const noDelivery = {
  email: { enabled: false },
  telegram: { enabled: false },
  slack: { enabled: false },
};

describe("computeNotifiesChannels", () => {
  it("returns the enabled default channels when no custom route matches", () => {
    const channels = computeNotifiesChannels({
      delivery: { ...noDelivery, email: { enabled: true } },
      routes: [],
      labelSets: [{ severity: "critical" }],
    });
    expect(channels).toEqual(["email"]);
  });

  it("resolves the first matching custom route per label set, by ascending priority", () => {
    const channels = computeNotifiesChannels({
      delivery: noDelivery,
      routes: [
        ccRoute({
          id: "low-priority",
          receiver: "fallback",
          priority: 100,
          matchers: [{ label: "team", op: "eq", value: "pay" }],
        }),
        ccRoute({
          id: "high-priority",
          receiver: "oncall",
          priority: 1,
          matchers: [{ label: "team", op: "eq", value: "pay" }],
        }),
      ],
      labelSets: [{ team: "pay" }],
    });
    expect(channels).toEqual(["oncall"]);
  });

  it("dedupes across defaults and custom routes, even when a custom receiver names a default channel", () => {
    const channels = computeNotifiesChannels({
      delivery: { ...noDelivery, email: { enabled: true } },
      routes: [
        ccRoute({
          id: "custom-email",
          receiver: "email",
          matchers: [{ label: "severity", op: "eq", value: "critical" }],
        }),
      ],
      labelSets: [{ severity: "critical" }],
    });
    expect(channels).toEqual(["email"]);
  });

  it("returns an empty array when nothing is enabled and nothing matches", () => {
    const channels = computeNotifiesChannels({
      delivery: undefined,
      routes: [],
      labelSets: [],
    });
    expect(channels).toEqual([]);
  });
});

describe("joinWithAnd", () => {
  it("joins two items with 'and' and three+ with an Oxford comma", () => {
    expect(joinWithAnd(["email"])).toBe("email");
    expect(joinWithAnd(["email", "slack"])).toBe("email and slack");
    expect(joinWithAnd(["email", "slack", "telegram"])).toBe(
      "email, slack and telegram",
    );
  });
});
