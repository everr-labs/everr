import { expect, it } from "vitest";
import { appendBounded } from "./use-cc-events";

it("keeps only the last N items, newest first", () => {
  let buf: number[] = [];
  for (let i = 0; i < 5; i++) buf = appendBounded(buf, i, 3);
  expect(buf).toEqual([4, 3, 2]);
});
