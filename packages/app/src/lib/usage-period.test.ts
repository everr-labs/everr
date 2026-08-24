import { describe, expect, it } from "vitest";
import {
  resolveUsagePeriod,
  type UsagePeriodEntitlement,
} from "./usage-period";

const ACTIVE_PRO: UsagePeriodEntitlement = {
  tier: "pro",
  status: "active",
  currentPeriodStart: new Date("2026-08-17T14:35:12.000Z"),
  currentPeriodEnd: new Date("2026-09-17T14:35:12.000Z"),
};
const CURRENT_PERIOD_NOW = new Date("2026-08-24T10:00:00.000Z");

describe("resolveUsagePeriod", () => {
  it.each([
    "active",
    "trialing",
  ])("uses the exact %s subscription period", (status) => {
    const period = resolveUsagePeriod(
      { ...ACTIVE_PRO, status },
      CURRENT_PERIOD_NOW,
    );

    expect(period).toEqual({
      from: new Date("2026-08-17T14:35:12.000Z"),
      to: new Date("2026-09-17T14:35:12.000Z"),
      source: "subscription",
    });
  });

  it("accepts serialized subscription dates", () => {
    const period = resolveUsagePeriod(
      {
        ...ACTIVE_PRO,
        currentPeriodStart: "2026-08-17T14:35:12.000Z",
        currentPeriodEnd: "2026-09-17T14:35:12.000Z",
      },
      CURRENT_PERIOD_NOW,
    );

    expect(period.source).toBe("subscription");
    expect(period.from.toISOString()).toBe("2026-08-17T14:35:12.000Z");
    expect(period.to.toISOString()).toBe("2026-09-17T14:35:12.000Z");
  });

  it.each([
    { ...ACTIVE_PRO, tier: "free" as const },
    { ...ACTIVE_PRO, status: "canceled" },
    { ...ACTIVE_PRO, currentPeriodStart: null },
    { ...ACTIVE_PRO, currentPeriodEnd: null },
    {
      ...ACTIVE_PRO,
      currentPeriodStart: new Date("2026-09-17T14:35:12.000Z"),
      currentPeriodEnd: new Date("2026-08-17T14:35:12.000Z"),
    },
  ])("falls back to the UTC calendar month", (entitlement) => {
    const period = resolveUsagePeriod(
      entitlement,
      new Date("2026-08-31T23:30:00-07:00"),
    );

    expect(period).toEqual({
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-10-01T00:00:00.000Z"),
      source: "calendar_month",
    });
  });

  it.each([
    new Date("2026-08-17T14:35:11.999Z"),
    new Date("2026-09-17T14:35:12.000Z"),
  ])("falls back when trusted time is outside the subscription bounds", (now) => {
    expect(resolveUsagePeriod(ACTIVE_PRO, now).source).toBe("calendar_month");
  });

  it("treats the subscription start as part of the half-open period", () => {
    expect(
      resolveUsagePeriod(ACTIVE_PRO, new Date("2026-08-17T14:35:12.000Z"))
        .source,
    ).toBe("subscription");
  });

  it("rejects an invalid current time", () => {
    expect(() => resolveUsagePeriod(ACTIVE_PRO, new Date(Number.NaN))).toThrow(
      RangeError,
    );
  });
});
