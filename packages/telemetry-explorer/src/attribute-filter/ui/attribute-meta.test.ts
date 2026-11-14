import { describe, expect, it } from "vite-plus/test";
import { attributeLabel, opTakesValues } from "./attribute-meta";

describe("attribute metadata", () => {
  it("knows which ops take values", () => {
    expect(opTakesValues("in")).toBe(true);
    expect(opTakesValues("not_in")).toBe(true);
    expect(opTakesValues("exists")).toBe(false);
    expect(opTakesValues("missing")).toBe(false);
  });

  it("returns a friendly label for known keys, undefined otherwise", () => {
    expect(attributeLabel("service.name")).toBe("Service");
    expect(attributeLabel("http.route")).toBe("Route");
    expect(attributeLabel("custom.unknown.thing")).toBeUndefined();
  });
});
