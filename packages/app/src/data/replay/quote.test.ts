import { describe, expect, it } from "vite-plus/test";
import { distance, hexId, q } from "./quote.ts";

const HOSTILE = [
  'a" injected="yes',
  "\u001b[31mred\u001b[0m\u001b]0;title\u0007",
  "\u202Eevil\u202C and \u2066isolate\u2069 \u200F",
  "zero\u200Bwidth\u200D\uFEFF\u2060",
  "tag\u{E0041}\u{E0042}\u{E007F}chars",
  "x".repeat(10_000),
  "lone \uD800 surrogate \uDC00",
  "line\u2028sep\u2029para\r\nnext",
  "c1\u0085control\u009B",
  "vt\u000Bform\u000Cfeed",
];

const INVISIBLE_OR_CONTROL =
  // oxlint-disable-next-line no-control-regex -- the test looks for control characters.
  /[\u0000-\u001F\u007F-\u009F\u061C\u200B-\u200F\u202A-\u202E\u2028\u2029\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/u;

describe("q", () => {
  it.each(HOSTILE.map((h) => [JSON.stringify(h).slice(0, 40), h]))(
    "makes %s one visible quoted value",
    (_name, raw) => {
      const value = q(raw, 80);
      const parsed: unknown = JSON.parse(value);
      expect(typeof parsed).toBe("string");
      const text = String(parsed);
      expect(text).not.toMatch(INVISIBLE_OR_CONTROL);
      expect(text).not.toMatch(/[\uD800-\uDFFF]/);
      expect(Array.from(text).length).toBeLessThanOrEqual(80);
      // The value spans one line and has no unescaped quote inside.
      expect(value).not.toMatch(/[\r\n]/);
      expect(value.slice(1, -1)).not.toMatch(/(^|[^\\])"/);
    },
  );

  it("caps by code points and marks the cut", () => {
    const value = JSON.parse(q("\u{1F600}".repeat(100), 10)) as string;
    expect(Array.from(value)).toHaveLength(10);
    expect(value.endsWith("...")).toBe(true);
  });
});

describe("hexId and distance", () => {
  it("prints a hex id bare and quotes anything else", () => {
    expect(hexId("8fa44e8b05e90c9b9204397b6efeb32f")).toBe("8fa44e8b05e90c9b9204397b6efeb32f");
    expect(hexId("8fa4 $(id)")).toBe('"8fa4 $(id)"');
  });

  it("says a distance in the largest units that fit", () => {
    expect(distance(41_400)).toBe("41s");
    expect(distance(-192_000)).toBe("3m12s");
    expect(distance(7_500_000)).toBe("2h05m");
  });
});
