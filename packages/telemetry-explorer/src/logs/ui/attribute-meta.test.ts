import { describe, expect, it } from "vitest";
import {
  ATTRIBUTE_OP_LABELS,
  ATTRIBUTE_SOURCE_LABELS,
  attributeLabel,
  PROMOTED_ATTRIBUTES,
} from "./attribute-meta";

describe("attribute metadata", () => {
  it("labels every op", () => {
    expect(ATTRIBUTE_OP_LABELS.in).toBe("Is");
    expect(ATTRIBUTE_OP_LABELS.not_in).toBe("Is not");
    expect(ATTRIBUTE_OP_LABELS.exists).toBe("Exists");
    expect(ATTRIBUTE_OP_LABELS.missing).toBe("Missing");
  });

  it("labels every source", () => {
    expect(ATTRIBUTE_SOURCE_LABELS.resource).toBe("Resource");
    expect(ATTRIBUTE_SOURCE_LABELS.log).toBe("Log");
    expect(ATTRIBUTE_SOURCE_LABELS.scope).toBe("Scope");
  });

  it("promotes repository, environment, and host as resource attributes", () => {
    expect(PROMOTED_ATTRIBUTES).toEqual([
      { source: "resource", key: "vcs.repository.name", label: "Repository" },
      {
        source: "resource",
        key: "deployment.environment",
        label: "Environment",
      },
      { source: "resource", key: "host.name", label: "Host" },
    ]);
  });

  it("returns a friendly label for a known attribute key", () => {
    expect(attributeLabel("vcs.repository.name")).toBe("Repository");
    expect(attributeLabel("deployment.environment")).toBe("Environment");
    expect(attributeLabel("service.name")).toBe("Service");
  });

  it("returns undefined for an unknown attribute key", () => {
    expect(attributeLabel("custom.unknown.thing")).toBeUndefined();
  });

  it("derives promoted labels from the known-attribute dictionary", () => {
    for (const promoted of PROMOTED_ATTRIBUTES) {
      expect(promoted.label).toBe(attributeLabel(promoted.key));
    }
  });
});
