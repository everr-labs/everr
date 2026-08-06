import { describe, expect, it } from "vitest";
import { alertingRuleViewFixture as alertingRule } from "@/data/alerting/test-fixtures";
import { alertingRuleHandles, alertingRuleIdentity } from "./rule-identity";

describe("alertingRuleIdentity", () => {
  it("splits a qualified name into project and slug", () => {
    const identity = alertingRuleIdentity(
      alertingRule({ name: "payments/checkout-latency" }),
    );
    expect(identity.project).toBe("payments");
    expect(identity.slug).toBe("checkout-latency");
    expect(identity.name).toBe("checkout-latency");
  });

  it("prefers the everr.display.name annotation over the slug for the human name", () => {
    const identity = alertingRuleIdentity(
      alertingRule({
        name: "default/checkout-latency",
        spec: {
          annotations: { "everr.display.name": "High checkout latency" },
        },
      }),
    );
    expect(identity.name).toBe("High checkout latency");
    // The slug stays the as-code slug regardless of the display name.
    expect(identity.slug).toBe("checkout-latency");
  });
});

describe("alertingRuleHandles", () => {
  it("returns only the canonical event slug", () => {
    const rule = alertingRule({
      id: "id-1",
      name: "payments/checkout-latency",
    });
    expect(alertingRuleHandles(rule)).toEqual(["payments/checkout-latency"]);
  });
});
