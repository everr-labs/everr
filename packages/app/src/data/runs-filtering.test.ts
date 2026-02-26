import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/clickhouse", () => ({
  query: vi.fn(),
}));

import { buildFailingStepLogsSql, isFailureConclusion } from "./runs";

describe("runs failing log extraction", () => {
  it("detects failure conclusions", () => {
    expect(isFailureConclusion("failure")).toBe(true);
    expect(isFailureConclusion("FAILED")).toBe(true);
    expect(isFailureConclusion("success")).toBe(false);
    expect(isFailureConclusion("error")).toBe(false);
  });

  it("builds SQL with fixed ±5 context and chronological ordering", () => {
    const sql = buildFailingStepLogsSql();
    expect(sql).toContain("abs(toInt64(s.line_no) - toInt64(x)) <= toInt64(5)");
    expect(sql).toContain("ORDER BY line_no ASC");
    expect(sql).not.toContain("anchor_score");
    expect(sql).not.toContain("LIMIT {maxLines:UInt32}");
  });
});
