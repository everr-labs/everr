import { describe, expect, it } from "vitest";
import { compareRuleLabels, silenceImpact } from "./format";

describe("silenceImpact", () => {
  it("keeps holds and suppressions apart: one may still go out, one never will", () => {
    expect(silenceImpact({ held: 3, dropped: 1 })).toBe("held 3 · dropped 1");
    expect(silenceImpact({ held: 3, dropped: 0 })).toBe("held 3");
    expect(silenceImpact({ held: 0, dropped: 1 })).toBe("dropped 1");
  });

  it("reports nothing at all when a silence withheld nothing", () => {
    expect(silenceImpact({ held: 0, dropped: 0 })).toBeNull();
  });
});

describe("compareRuleLabels", () => {
  const order = (rules: { label: string; path: string }[]) =>
    rules
      .slice()
      .sort(compareRuleLabels)
      .map((rule) => rule.path);

  it("orders by the label the list prints, not by the path behind it", () => {
    expect(
      order([
        { label: "Zeta latency", path: "aaa/zeta" },
        { label: "Alpha latency", path: "zzz/alpha" },
      ]),
    ).toEqual(["zzz/alpha", "aaa/zeta"]);
  });

  it("does not split a run of names on case", () => {
    expect(
      order([
        { label: "beta", path: "demo/beta" },
        { label: "Alpha", path: "demo/alpha" },
        { label: "Gamma", path: "demo/gamma" },
      ]),
    ).toEqual(["demo/alpha", "demo/beta", "demo/gamma"]);
  });

  it("counts numbers in a label rather than comparing them as text", () => {
    expect(
      order([
        { label: "shard-10 saturation", path: "demo/s10" },
        { label: "shard-2 saturation", path: "demo/s2" },
      ]),
    ).toEqual(["demo/s2", "demo/s10"]);
  });

  it("falls back to the path when two rules display the same name", () => {
    expect(
      order([
        { label: "High 5xx", path: "web/high-5xx" },
        { label: "High 5xx", path: "api/high-5xx" },
      ]),
    ).toEqual(["api/high-5xx", "web/high-5xx"]);
  });
});
