import type { LayoutItem } from "react-grid-layout";
import { describe, expect, it } from "vitest";
import {
  panelKeyFromRef,
  panelRefFromKey,
  persesToRGL,
  rglToPerses,
  sameLayoutItems,
} from "./convert";
import type { GridItem } from "./schema";

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

describe("sameLayoutItems", () => {
  const a: GridItem[] = [
    { x: 0, y: 0, width: 12, height: 8, content: { $ref: "#/spec/panels/p1" } },
    {
      x: 12,
      y: 0,
      width: 12,
      height: 8,
      content: { $ref: "#/spec/panels/p2" },
    },
  ];

  it("is true for identical layouts", () => {
    expect(
      sameLayoutItems(
        a,
        a.map((i) => ({ ...i })),
      ),
    ).toBe(true);
  });

  it("is true regardless of item order (position is by geometry)", () => {
    expect(sameLayoutItems(a, [a[1]!, a[0]!])).toBe(true);
  });

  it("is false when a panel moved", () => {
    const moved = [{ ...a[0]!, x: 6 }, a[1]!];
    expect(sameLayoutItems(a, moved)).toBe(false);
  });

  it("is false when a panel was resized", () => {
    const resized = [{ ...a[0]!, height: 10 }, a[1]!];
    expect(sameLayoutItems(a, resized)).toBe(false);
  });

  it("is false when the item count differs", () => {
    expect(sameLayoutItems(a, [a[0]!])).toBe(false);
  });

  it("is false when a panel ref differs", () => {
    const renamed = [
      { ...a[0]!, content: { $ref: "#/spec/panels/other" } },
      a[1]!,
    ];
    expect(sameLayoutItems(a, renamed)).toBe(false);
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
