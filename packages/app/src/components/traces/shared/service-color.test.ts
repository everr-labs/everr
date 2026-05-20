import { describe, expect, it } from "vitest";
import { serviceColor } from "./service-color";

describe("serviceColor", () => {
  it("returns a stable color for the same (namespace, name)", () => {
    const first = serviceColor("github", "actions-runner");
    for (let i = 0; i < 100; i++) {
      expect(serviceColor("github", "actions-runner")).toBe(first);
    }
  });

  it("differentiates namespace from name", () => {
    const a = serviceColor("github", "actions");
    const b = serviceColor("", "github/actions");
    expect(a).not.toBe(b);
  });

  it("spreads across multiple palette slots on a small set", () => {
    const services: Array<[string, string]> = [
      ["github", "actions-runner"],
      ["github", "scheduler"],
      ["app", "api"],
      ["app", "worker"],
      ["everr", "ingest"],
      ["everr", "query"],
      ["", "lonely"],
    ];
    const colors = new Set(services.map(([ns, n]) => serviceColor(ns, n)));
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });

  it("returns a CSS variable reference", () => {
    expect(serviceColor("ns", "svc")).toMatch(/^var\(--trace-service-\d\)$/);
  });
});
