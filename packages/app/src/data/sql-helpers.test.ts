import { describe, expect, it } from "vitest";
import { testFullNameExpr } from "./sql-helpers";

describe("testFullNameExpr", () => {
  it("builds aliased expression by default", () => {
    const sql = testFullNameExpr();
    expect(sql).toContain("as test_full_name");
    expect(sql).toContain("concat(");
  });

  it("builds expression without alias when alias is null", () => {
    const sql = testFullNameExpr(null);
    expect(sql).not.toContain(" as ");
  });
});
