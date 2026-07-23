import { describe, expect, it } from "vitest";
import { attributionAttributes } from "./attribution.js";

describe("attributionAttributes", () => {
  it("stamps UTM params from the landing query string", () => {
    expect(
      attributionAttributes(
        "?utm_source=news&utm_medium=email&utm_campaign=launch",
      ),
    ).toEqual({
      "everr.utm.source": "news",
      "everr.utm.medium": "email",
      "everr.utm.campaign": "launch",
    });
  });

  it("does not stamp ad click ids (deferred)", () => {
    expect(attributionAttributes("?gclid=g1&fbclid=f1")).toEqual({});
  });

  it("stamps nothing on organic traffic", () => {
    expect(attributionAttributes("")).toEqual({});
  });

  it("ignores garbage input", () => {
    expect(attributionAttributes("not a query string")).toEqual({});
  });
});
