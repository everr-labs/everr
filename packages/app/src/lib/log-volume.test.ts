import { describe, expect, it } from "vitest";
import type { ParsedLogLine } from "./log-parser";
import { aggregateLogVolume } from "./log-volume";

function makeLine(
  timestamp: string,
  markerType?: ParsedLogLine["markerType"],
  isGroupEnd?: boolean,
): ParsedLogLine {
  return {
    timestamp,
    body: "test",
    htmlContent: "test",
    markerType,
    isGroupEnd,
  };
}

describe("aggregateLogVolume", () => {
  it("returns empty array for no lines", () => {
    expect(aggregateLogVolume([])).toEqual([]);
  });

  it("handles a single log line", () => {
    const bins = aggregateLogVolume([makeLine("2025-01-01T00:00:00Z")]);
    expect(bins).toHaveLength(1);
    expect(bins[0].info).toBe(1);
  });

  it("handles all logs at the same timestamp", () => {
    const bins = aggregateLogVolume([
      makeLine("2025-01-01T00:00:00Z"),
      makeLine("2025-01-01T00:00:00Z", "error"),
      makeLine("2025-01-01T00:00:00Z", "warning"),
    ]);
    expect(bins).toHaveLength(1);
    expect(bins[0].info).toBe(1);
    expect(bins[0].error).toBe(1);
    expect(bins[0].warning).toBe(1);
  });

  it("skips group end lines", () => {
    const bins = aggregateLogVolume([
      makeLine("2025-01-01T00:00:00Z"),
      makeLine("2025-01-01T00:00:00Z", undefined, true),
    ]);
    expect(bins).toHaveLength(1);
    expect(bins[0].info).toBe(1);
  });

  it("counts different marker types correctly", () => {
    const bins = aggregateLogVolume([
      makeLine("2025-01-01T00:00:00Z", "error"),
      makeLine("2025-01-01T00:00:00Z", "warning"),
      makeLine("2025-01-01T00:00:00Z", "notice"),
      makeLine("2025-01-01T00:00:00Z", "debug"),
      makeLine("2025-01-01T00:00:00Z", "command"),
      makeLine("2025-01-01T00:00:00Z"),
    ]);
    expect(bins).toHaveLength(1);
    expect(bins[0].error).toBe(1);
    expect(bins[0].warning).toBe(1);
    expect(bins[0].notice).toBe(1);
    expect(bins[0].debug).toBe(1);
    expect(bins[0].command).toBe(1);
    expect(bins[0].info).toBe(1);
  });

  it("distributes logs across multiple bins", () => {
    const bins = aggregateLogVolume([
      makeLine("2025-01-01T00:00:00Z"),
      makeLine("2025-01-01T00:00:05Z"),
      makeLine("2025-01-01T00:00:10Z"),
    ]);
    // 10s duration -> 1s bins
    expect(bins.length).toBeGreaterThan(1);
    expect(bins[0].info).toBe(1);
  });

  it("tracks firstLineIndex per bin", () => {
    const bins = aggregateLogVolume([
      makeLine("2025-01-01T00:00:00Z"),
      makeLine("2025-01-01T00:00:01Z"),
      makeLine("2025-01-01T00:00:05Z"),
    ]);
    expect(bins[0].firstLineIndex).toBe(0);
  });

  it("returns only non-trailing-empty bins", () => {
    // All logs within a small time window, but duration creates bins beyond them
    const bins = aggregateLogVolume([
      makeLine("2025-01-01T00:00:00Z"),
      makeLine("2025-01-01T00:00:10Z"),
    ]);
    const lastBin = bins[bins.length - 1];
    const hasContent =
      lastBin.error +
        lastBin.warning +
        lastBin.notice +
        lastBin.debug +
        lastBin.command +
        lastBin.info >
      0;
    expect(hasContent).toBe(true);
  });
});
