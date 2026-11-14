import { describe, expect, it } from "vite-plus/test";
import { profilesSearchForTrace } from "./trace-link";

describe("profilesSearchForTrace", () => {
  it("covers profiles stamped before the trace starts and flushed after it ends", () => {
    const search = profilesSearchForTrace("abc", {
      start: new Date("2026-01-01T10:00:00.000Z"),
      end: new Date("2026-01-01T10:00:02.000Z"),
    });
    expect(search.traceId).toBe("abc");
    expect(new Date(search.from) < new Date("2026-01-01T09:59:00.000Z")).toBe(true);
    expect(new Date(search.to) > new Date("2026-01-01T10:01:00.000Z")).toBe(true);
  });

  it("narrows to one span when given its id", () => {
    const window = { start: new Date(0), end: new Date(1000) };
    expect(profilesSearchForTrace("abc", window, "def").spanId).toBe("def");
    expect(profilesSearchForTrace("abc", window)).not.toHaveProperty("spanId");
  });
});
