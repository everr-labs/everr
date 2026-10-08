import {
  defaultParseSearch,
  defaultStringifySearch,
} from "@tanstack/react-router";
import { expect, it } from "vitest";
import { HomeSearchSchema } from "./onboarding";

it("reopens onboarding from the actual URL parser and emits setup=1 in links", () => {
  const parsed = HomeSearchSchema.parse(defaultParseSearch("?setup=1"));
  expect(parsed.setup).toBe(1);
  expect(defaultStringifySearch(parsed)).toBe("?setup=1");
  expect(
    HomeSearchSchema.parse(defaultParseSearch("?setup=%221%22")).setup,
  ).toBe(1);
});

it.each([
  "",
  "?setup=0",
  "?setup=true",
  "?setup=invalid",
])("keeps the automatic Home decision for %s", (search) => {
  expect(
    HomeSearchSchema.parse(defaultParseSearch(search)).setup,
  ).toBeUndefined();
});
