import { describe, expect, it } from "vite-plus/test";
import { eventsFromSegments } from "./events";

describe("eventsFromSegments", () => {
  it("orders Segments by index and keeps the first body when an index repeats", () => {
    const events = eventsFromSegments([
      { index: 1, body: JSON.stringify([{ type: 3, timestamp: 20 }]) },
      { index: 0, body: JSON.stringify([{ type: 2, timestamp: 10 }]) },
      { index: 0, body: JSON.stringify([{ type: 4, timestamp: 99 }]) },
    ]);

    expect(events).toEqual([
      { type: 2, timestamp: 10 },
      { type: 3, timestamp: 20 },
    ]);
  });

  it("skips a Segment whose body is not an rrweb array", () => {
    const events = eventsFromSegments([
      { index: 0, body: "not-json" },
      { index: 1, body: JSON.stringify({ type: 2, timestamp: 1 }) },
      { index: 2, body: JSON.stringify([{ type: "bad", timestamp: 1 }, { timestamp: 2 }]) },
      { index: 3, body: JSON.stringify([{ type: 2, timestamp: 30 }]) },
    ]);

    expect(events).toEqual([{ type: 2, timestamp: 30 }]);
  });
});
