import { productClient } from "@composition/client";
import { describe, expect, it } from "vitest";
import { BUILTIN_DASHBOARDS, getBuiltinDashboard } from "./catalog";
import { BUILTIN_MANIFEST } from "./manifest";

describe("built-in manifest", () => {
  it("loads the advertised catalog and the configured home dashboard", () => {
    expect(BUILTIN_MANIFEST).toEqual(
      BUILTIN_DASHBOARDS.map(({ id, name }) => ({ id, name })),
    );
    expect(getBuiltinDashboard(productClient.homeDashboardId)?.id).toBe(
      productClient.homeDashboardId,
    );
  });
});
