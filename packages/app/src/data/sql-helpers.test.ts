import { describe, expect, it } from "vitest";
import { leafTestFilter, testFullNameExpr } from "./sql-helpers";

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

describe("leafTestFilter", () => {
  it("supports scoped extra conditions", () => {
    const sql = leafTestFilter({
      extraConditions: [
        "ResourceAttributes['vcs.repository.name'] = {repo:String}",
        "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
      ],
    });

    expect(sql).toContain("NOT IN");
    expect(sql).toContain(
      "ResourceAttributes['vcs.repository.name'] = {repo:String}",
    );
    expect(sql).toContain(
      "ResourceAttributes['vcs.ref.head.name'] = {branch:String}",
    );
  });

  it("supports custom left and right expressions", () => {
    const sql = leafTestFilter({
      leftExpr: "tuple(pkg, test_full_name)",
      rightExpr: "tuple(pkg, parent_test)",
    });

    expect(sql).toContain("tuple(pkg, test_full_name) NOT IN");
    expect(sql).toContain("SELECT DISTINCT tuple(pkg, parent_test)");
  });
});
