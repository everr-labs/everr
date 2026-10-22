import { describe, expect, it } from "vite-plus/test";
import { panelKeyFromRef, persesToRGL } from "./convert";
import type { GridItem } from "./schema";

describe("panelKeyFromRef", () => {
  it("extracts panel key from $ref", () => {
    expect(panelKeyFromRef("#/spec/panels/myPanel")).toBe("myPanel");
  });
});

describe("persesToRGL", () => {
  it("converts Perses GridItems to react-grid-layout Layout", () => {
    const items: GridItem[] = [
      {
        x: 0,
        y: 0,
        width: 12,
        height: 8,
        content: { $ref: "#/spec/panels/requestRate" },
      },
      {
        x: 12,
        y: 0,
        width: 12,
        height: 8,
        content: { $ref: "#/spec/panels/errorRate" },
      },
    ];
    const result = persesToRGL(items);
    expect(result).toEqual([
      { i: "requestRate", x: 0, y: 0, w: 12, h: 8 },
      { i: "errorRate", x: 12, y: 0, w: 12, h: 8 },
    ]);
  });
});
