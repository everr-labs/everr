import { describe, expect, it } from "vitest";
import { serviceColor } from "./service-color";

describe("serviceColor", () => {
  it("returns a stable color for the same name", () => {
    const first = serviceColor("actions-runner");
    for (let i = 0; i < 100; i++) {
      expect(serviceColor("actions-runner")).toBe(first);
    }
  });

  it("spreads across multiple palette slots on a small set", () => {
    const services = [
      "actions-runner",
      "scheduler",
      "api",
      "worker",
      "ingest",
      "query",
      "lonely",
    ];
    const colors = new Set(services.map((n) => serviceColor(n)));
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });

  it("returns a CSS variable reference", () => {
    expect(serviceColor("svc")).toMatch(/^var\(--trace-service-\d\)$/);
  });
});
