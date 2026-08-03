import { describe, expect, it } from "vitest";
import { ccRuleViewFixture as ccRule } from "@/data/cc/test-fixtures";
import { ccRuleHandles, ccRuleIdentity } from "./rule-identity";

describe("ccRuleIdentity", () => {
  it("splits a qualified name into project and slug", () => {
    const identity = ccRuleIdentity(
      ccRule({ name: "payments/checkout-latency" }),
    );
    expect(identity.project).toBe("payments");
    expect(identity.slug).toBe("checkout-latency");
    expect(identity.name).toBe("checkout-latency");
  });

  it("reads a slashless (engine-native) name as a slug in the default project", () => {
    const identity = ccRuleIdentity(ccRule({ name: "rule-ab12cd34" }));
    expect(identity.project).toBe("default");
    expect(identity.slug).toBe("rule-ab12cd34");
    expect(identity.name).toBe("rule-ab12cd34");
  });

  it("prefers the everr.display.name annotation over the slug for the human name", () => {
    const identity = ccRuleIdentity(
      ccRule({
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

describe("ccRuleHandles", () => {
  it("returns [id, name] with no legacy handle for a slashless name", () => {
    const rule = ccRule({ id: "id-1", name: "rule-ab12cd34" });
    expect(ccRuleHandles(rule)).toEqual(["id-1", "rule-ab12cd34"]);
  });

  it("appends the bare slug as a legacy handle for a qualified name", () => {
    const rule = ccRule({ id: "id-1", name: "payments/checkout-latency" });
    expect(ccRuleHandles(rule)).toEqual([
      "id-1",
      "payments/checkout-latency",
      "checkout-latency",
    ]);
  });
});
