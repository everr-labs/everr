import { describe, expect, it } from "vite-plus/test";
import { serviceColor, serviceColors } from "./service-color";

describe("serviceColor", () => {
  it("returns a stable color for the same name", () => {
    const first = serviceColor("actions-runner");
    for (let i = 0; i < 100; i++) {
      expect(serviceColor("actions-runner")).toBe(first);
    }
  });

  it("spreads across multiple palette slots on a small set", () => {
    const services = ["actions-runner", "scheduler", "api", "worker", "ingest", "query", "lonely"];
    const colors = new Set(services.map((n) => serviceColor(n)));
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });

  it("returns a CSS variable reference", () => {
    expect(serviceColor("svc")).toMatch(/^var\(--trace-service-\d\)$/);
  });
});

describe("serviceColors", () => {
  it("gives every group in a view its own color", () => {
    // These two hash to the same slot.
    const colors = serviceColors(["web-frontend", "api-gateway", "inventory-service"]);
    expect(new Set(colors.values()).size).toBe(3);
  });

  it("keeps the hashed color for the first group to claim a slot", () => {
    const colors = serviceColors(["web-frontend", "api-gateway"]);
    expect(colors.get("web-frontend")).toBe(serviceColor("web-frontend"));
  });
});
