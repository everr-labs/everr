import type { LayoutItem } from "react-grid-layout";
import { describe, expect, it } from "vitest";
import {
  panelKeyFromRef,
  panelRefFromKey,
  persesToRGL,
  rglToPerses,
} from "./convert";
import type { GridItem } from "./types";

describe("panelKeyFromRef", () => {
  it("extracts panel key from $ref", () => {
    expect(panelKeyFromRef("#/spec/panels/myPanel")).toBe("myPanel");
  });
});

describe("panelRefFromKey", () => {
  it("creates $ref from panel key", () => {
    expect(panelRefFromKey("myPanel")).toBe("#/spec/panels/myPanel");
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

describe("rglToPerses", () => {
  it("converts react-grid-layout Layout back to Perses GridItems", () => {
    const layout: LayoutItem[] = [
      { i: "requestRate", x: 0, y: 0, w: 12, h: 8 },
      { i: "errorRate", x: 12, y: 0, w: 6, h: 4 },
    ];
    const result = rglToPerses(layout);
    expect(result).toEqual([
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
        width: 6,
        height: 4,
        content: { $ref: "#/spec/panels/errorRate" },
      },
    ]);
  });
});
