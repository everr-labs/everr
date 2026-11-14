import { describe, expect, it } from "vite-plus/test";
import { persesToRGL, stackLayout } from "./convert";
import type { GridItem } from "./schema";

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

describe("stackLayout", () => {
  it("stacks panels full width in reading order, keeping their heights", () => {
    // A tall panel on the left beside two short ones on the right, then a
    // full-width row after an authored gap.
    const result = stackLayout(
      [
        { i: "below", x: 0, y: 10, w: 24, h: 4 },
        { i: "right-bottom", x: 12, y: 4, w: 12, h: 4 },
        { i: "right-top", x: 12, y: 0, w: 12, h: 4 },
        { i: "left", x: 0, y: 0, w: 12, h: 8 },
      ],
      24,
    );
    expect(result).toEqual([
      { i: "left", x: 0, y: 0, w: 24, h: 8 },
      { i: "right-top", x: 0, y: 8, w: 24, h: 4 },
      { i: "right-bottom", x: 0, y: 12, w: 24, h: 4 },
      { i: "below", x: 0, y: 16, w: 24, h: 4 },
    ]);
  });
});
