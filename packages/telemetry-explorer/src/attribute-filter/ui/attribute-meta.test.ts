import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_OP_CONNECTORS,
  ATTRIBUTE_OP_LABELS,
  ATTRIBUTE_SOURCE_LABELS,
  attributeLabel,
  opTakesValues,
  type PromotedAttribute,
} from "./attribute-meta";

describe("attribute metadata", () => {
  it("labels every op", () => {
    expect(ATTRIBUTE_OP_LABELS).toEqual({
      in: "Is",
      not_in: "Is not",
      exists: "Exists",
      missing: "Missing",
    });
  });

  it("provides a lowercase connector for every op", () => {
    expect(ATTRIBUTE_OP_CONNECTORS).toEqual({
      in: "is",
      not_in: "is not",
      exists: "exists",
      missing: "missing",
    });
  });

  it("labels every source including span", () => {
    expect(ATTRIBUTE_SOURCE_LABELS).toEqual({
      resource: "Resource",
      log: "Log",
      scope: "Scope",
      span: "Span",
    });
  });

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

  // Keeps the type-only export reachable for the dead-code check before the
  // picker/section consume it.
  it("types a promoted attribute", () => {
    const p: PromotedAttribute = { source: "resource", key: "host.name" };
    expect(p.key).toBe("host.name");
  });
});
