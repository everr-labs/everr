import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: {
    POLAR_PRO_PRODUCT_ID: "product_pro_current",
    POLAR_PRO_LEGACY_PRODUCT_IDS: "product_pro_legacy_1, product_pro_legacy_2",
  },
}));

import {
  assertPolarProductGrantsPlan,
  planForPolarProductId,
  polarProductIdForPlan,
  UnknownPolarProductError,
} from "./catalog.server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Polar Product catalog", () => {
  it("uses the current Product for a new Pro checkout", () => {
    expect(polarProductIdForPlan("pro")).toBe("product_pro_current");
  });

  it.each([
    "product_pro_current",
    "product_pro_legacy_1",
    "product_pro_legacy_2",
  ])("maps the configured Product %s to Pro", (productId) => {
    expect(planForPolarProductId(productId)).toBe("pro");
    expect(() => assertPolarProductGrantsPlan(productId, "pro")).not.toThrow();
  });

  it("throws a critical error for an unknown Product", () => {
    expect(() => planForPolarProductId("product_unknown")).toThrow(
      UnknownPolarProductError,
    );
  });
});
