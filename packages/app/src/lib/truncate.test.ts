import { describe, expect, it } from "vite-plus/test";
import { truncateWithEllipsis } from "./truncate";

describe("truncateWithEllipsis", () => {
  it("returns the input unchanged when at or under the limit", () => {
    expect(truncateWithEllipsis("abc", 3)).toBe("abc");
    expect(truncateWithEllipsis("abc", 10)).toBe("abc");
  });

  it("truncates with an ellipsis when over the limit", () => {
    expect(truncateWithEllipsis("abcdef", 4)).toBe("abc…");
  });

  it("caps the result at the requested length", () => {
    expect(truncateWithEllipsis("x".repeat(5000), 4096).length).toBe(4096);
  });

  it("does not split a surrogate pair at the boundary", () => {
    // 😀 is U+1F600, two UTF-16 units (0xd83d 0xde00). Placed so the high
    // surrogate lands on the last kept position — a naive slice would emit it
    // alone, producing a lone surrogate.
    const input = `${"x".repeat(4094)}😀tail`;
    const out = truncateWithEllipsis(input, 4096);
    expect(out).toBe(`${"x".repeat(4094)}…`);
    expect(out.length).toBe(4095);
    // Unicode mode treats valid pairs as one code point, so this matches only
    // lone surrogate code points.
    expect(out).not.toMatch(/[\uD800-\uDFFF]/u);
  });

  it("keeps a pair that ends exactly at the boundary", () => {
    // The pair occupies the last two kept units; no backup needed.
    const input = `${"x".repeat(4093)}😀tail`;
    const out = truncateWithEllipsis(input, 4096);
    expect(out).toBe(`${"x".repeat(4093)}😀…`);
    expect(out.length).toBe(4096);
  });
});
