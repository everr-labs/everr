import { describe, expect, it } from "vitest";
import { nextGroupFlushAt } from "./grouping";

const now = new Date("2026-08-06T10:00:00Z");

describe("nextGroupFlushAt", () => {
  it("uses group wait for a new notification group", () => {
    expect(nextGroupFlushAt(null, now, 30, 300).toISOString()).toBe(
      "2026-08-06T10:00:30.000Z",
    );
  });

  it("does not postpone the first flush when more events arrive", () => {
    const first = new Date("2026-08-06T10:00:10Z");
    expect(
      nextGroupFlushAt(
        { nextFlushAt: first, lastFlushedAt: null },
        now,
        30,
        300,
      ),
    ).toEqual(first);
  });

  it("pulls a repeat forward to the earliest group interval", () => {
    expect(
      nextGroupFlushAt(
        {
          nextFlushAt: new Date("2026-08-06T12:00:00Z"),
          lastFlushedAt: new Date("2026-08-06T09:58:00Z"),
        },
        now,
        30,
        300,
      ).toISOString(),
    ).toBe("2026-08-06T10:03:00.000Z");
  });

  it("keeps an already earlier scheduled flush", () => {
    const scheduled = new Date("2026-08-06T10:01:00Z");
    expect(
      nextGroupFlushAt(
        {
          nextFlushAt: scheduled,
          lastFlushedAt: new Date("2026-08-06T09:58:00Z"),
        },
        now,
        30,
        300,
      ),
    ).toEqual(scheduled);
  });
});
