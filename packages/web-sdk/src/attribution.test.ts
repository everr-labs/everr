import { describe, expect, it } from "vitest";
import { attributionAttributes } from "./attribution.js";

describe("attributionAttributes", () => {
  it("stamps UTM params from the landing URL", () => {
    expect(
      attributionAttributes(
        "https://everr.dev/?utm_source=news&utm_medium=email&utm_campaign=launch",
      ),
    ).toEqual({
      "everr.utm.source": "news",
      "everr.utm.medium": "email",
      "everr.utm.campaign": "launch",
    });
  });

  it("stamps ad click ids", () => {
    expect(
      attributionAttributes("https://everr.dev/docs?gclid=g1&fbclid=f1"),
    ).toEqual({
      "everr.ad_id.gclid": "g1",
      "everr.ad_id.fbclid": "f1",
    });
  });

  it("stamps nothing on organic traffic", () => {
    expect(attributionAttributes("https://everr.dev/docs")).toEqual({});
  });

  it("returns nothing for an unparsable URL", () => {
    expect(attributionAttributes("not a url")).toEqual({});
  });
});
