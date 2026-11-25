import { describe, expect, it } from "vite-plus/test";
import { runtimeFrameNote } from "./runtime-frames";

describe("runtimeFrameNote", () => {
  it("explains the profiler's runtime frames", () => {
    expect(runtimeFrameNote("Non JS threads activity")).toContain("CPU time can exceed wall time");
  });

  it("has nothing to say about an ordinary function, whatever its name", () => {
    expect(runtimeFrameNote("handler")).toBeUndefined();
    expect(runtimeFrameNote("__proto__")).toBeUndefined();
    expect(runtimeFrameNote("constructor")).toBeUndefined();
  });
});
