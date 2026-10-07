import { describe, expect, it } from "vitest";
import { shouldHoldForSqlApiSetup } from "./gate";

describe("shouldHoldForSqlApiSetup", () => {
  it("lets a ready organization through", () => {
    expect(shouldHoldForSqlApiSetup("ready", "/")).toBe(false);
  });

  it("holds the dashboard while setup is unfinished", () => {
    expect(shouldHoldForSqlApiSetup("pending", "/")).toBe(true);
    expect(shouldHoldForSqlApiSetup("failed", "/dashboards")).toBe(true);
  });

  it("leaves account settings and checkout completion reachable", () => {
    expect(shouldHoldForSqlApiSetup("pending", "/account")).toBe(false);
    expect(shouldHoldForSqlApiSetup("failed", "/checkout/success")).toBe(false);
  });
});
