import { describe, expect, it } from "vitest";
import {
  buildFilterOptionsQuery,
  decodeFilterOptionsRows,
} from "./filter-options";

describe("buildFilterOptionsQuery", () => {
  it("queries distinct services and repos within range", () => {
    const built = buildFilterOptionsQuery({
      timeRange: { from: "now-1h", to: "now" },
    });
    expect(built.sql).toContain("DISTINCT ServiceName");
    expect(built.sql).toContain("DISTINCT ResourceAttributes['vcs.repository.name']");
    expect(typeof built.params.fromTime).toBe("string");
  });
});

describe("decodeFilterOptionsRows", () => {
  it("returns empty arrays when no row", () => {
    expect(decodeFilterOptionsRows([])).toEqual({ services: [], repos: [] });
  });
});
