import { describe, expect, it } from "vite-plus/test";
import { readableForeground } from "./contrast";

describe("readableForeground", () => {
  it("chooses the better contrasting foreground for supported opaque colors", () => {
    expect(readableForeground("white")?.color).toBe("#000");
    expect(readableForeground("#111")?.color).toBe("#fff");
    expect(readableForeground("#eab308")?.color).toBe("#000");
  });

  it("checks the worst contrast across background tints", () => {
    const plain = readableForeground("#777");
    const tinted = readableForeground("#777", [
      { color: "white", opacity: 0.1 },
      { color: "black", opacity: 0.08 },
    ]);
    expect(plain!.contrast).toBeGreaterThanOrEqual(4.5);
    expect(tinted!.contrast).toBeLessThan(4.5);
  });

  it("does not silently treat unresolved or translucent colors as opaque", () => {
    expect(readableForeground("var(--card)")).toBeUndefined();
    expect(readableForeground("oklch(0.7 0.1 40)")).toBeUndefined();
    expect(readableForeground("rgba(255,0,0,0.25)")).toBeUndefined();
  });
});
