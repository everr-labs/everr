import { expect, it } from "vitest";
import { addMatcher, removeMatcher, updateMatcher } from "./matchers-editor";

it("adds, updates, removes matcher rows", () => {
  let m = addMatcher([]);
  expect(m).toEqual([{ label: "", op: "eq", value: "" }]);
  m = updateMatcher(m, 0, { label: "severity", value: "critical" });
  expect(m[0]).toEqual({ label: "severity", op: "eq", value: "critical" });
  m = removeMatcher(m, 0);
  expect(m).toEqual([]);
});
