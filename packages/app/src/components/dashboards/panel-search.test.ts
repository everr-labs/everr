import { describe, expect, it } from "vitest";
import {
  dashboardFrameSearchSchema,
  panelForKey,
  panelSearchSchema,
  readPanelKey,
} from "./panel-search";

describe("panel search", () => {
  it("keeps a panel key beside the rail flag", () => {
    expect(
      dashboardFrameSearchSchema.parse({ panel: "cpu", full: true }),
    ).toEqual({ panel: "cpu", full: true });
  });

  it("drops an empty or non-string panel key", () => {
    expect(
      dashboardFrameSearchSchema.parse({ panel: "" }).panel,
    ).toBeUndefined();
    expect(
      dashboardFrameSearchSchema.parse({ panel: ["cpu"] }).panel,
    ).toBeUndefined();
    expect(panelSearchSchema.parse({}).panel).toBeUndefined();
  });

  it("returns only a panel the dashboard defines", () => {
    const panels = { cpu: { name: "CPU" }, constructor: { name: "Built" } };
    expect(panelForKey(panels, "cpu")).toEqual({ name: "CPU" });
    expect(panelForKey(panels, "constructor")).toEqual({ name: "Built" });
    expect(panelForKey(panels, "toString")).toBeUndefined();
    expect(panelForKey(panels, "missing")).toBeUndefined();
  });

  it("reads only a non-empty string", () => {
    expect(readPanelKey({ panel: "cpu" })).toBe("cpu");
    expect(readPanelKey({ panel: "" })).toBeUndefined();
    expect(readPanelKey({})).toBeUndefined();
    expect(readPanelKey({ panel: 1 })).toBeUndefined();
    expect(readPanelKey(null)).toBeUndefined();
  });
});
