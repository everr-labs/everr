import { parseTimestampAsUTC } from "./formatting";
import type { ParsedLogLine } from "./log-parser";

export interface LogVolumeBin {
  timeLabel: string;
  startTime: number;
  firstLineIndex: number;
  error: number;
  warning: number;
  notice: number;
  debug: number;
  command: number;
  info: number;
}

/**
 * Calculate appropriate bin size based on total duration
 */
function calculateBinSize(durationMs: number): number {
  if (durationMs < 30_000) return 1_000; // < 30s: 1s bins
  if (durationMs < 60_000) return 2_000; // < 1 min: 2s bins
  if (durationMs < 180_000) return 5_000; // < 3 min: 5s bins
  if (durationMs < 600_000) return 15_000; // < 10 min: 15s bins
  if (durationMs < 1_800_000) return 30_000; // < 30 min: 30s bins
  return 60_000; // >= 30 min: 1m bins
}

/**
 * Format bin time label based on bin size
 */
function formatTimeLabel(date: Date, binSizeMs: number): string {
  if (binSizeMs < 60_000) {
    // Seconds-level precision
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  // Minute-level precision
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Aggregate parsed log lines into time bins for charting
 */
export function aggregateLogVolume(lines: ParsedLogLine[]): LogVolumeBin[] {
  if (lines.length === 0) return [];

  // Get time range from logs
  const timestamps = lines
    .filter((l) => !l.isGroupEnd)
    .map((l) => parseTimestampAsUTC(l.timestamp)?.getTime() ?? Number.NaN)
    .filter((timestamp) => !Number.isNaN(timestamp));

  if (timestamps.length === 0) return [];

  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const duration = maxTime - minTime;

  // Handle edge case: all logs at same timestamp
  if (duration === 0) {
    const bin = createEmptyBin(
      formatTimeLabel(new Date(minTime), 5_000),
      minTime,
      0,
    );
    for (const line of lines) {
      if (!line.isGroupEnd) {
        incrementBinCount(bin, line);
      }
    }
    return [bin];
  }

  const binSize = calculateBinSize(duration);
  const binCount = Math.ceil(duration / binSize) + 1;
  const bins: LogVolumeBin[] = [];

  // Create empty bins
  for (let i = 0; i < binCount; i++) {
    const binStart = minTime + i * binSize;
    bins.push(
      createEmptyBin(
        formatTimeLabel(new Date(binStart), binSize),
        binStart,
        -1,
      ),
    );
  }

  // Populate bins with log counts and track first line index per bin
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (line.isGroupEnd) continue;

    const lineTime = parseTimestampAsUTC(line.timestamp)?.getTime();
    if (lineTime === undefined) continue;
    const binIndex = Math.floor((lineTime - minTime) / binSize);
    const bin = bins[binIndex];

    if (bin) {
      incrementBinCount(bin, line);
      if (bin.firstLineIndex === -1) {
        bin.firstLineIndex = lineIndex;
      }
    }
  }

  // Remove trailing empty bins
  while (bins.length > 1 && isBinEmpty(bins[bins.length - 1])) {
    bins.pop();
  }

  // Ensure all bins have valid firstLineIndex (for empty bins, use next valid bin's index)
  let lastValidIndex = 0;
  for (let i = 0; i < bins.length; i++) {
    if (bins[i].firstLineIndex !== -1) {
      lastValidIndex = bins[i].firstLineIndex;
    } else {
      bins[i].firstLineIndex = lastValidIndex;
    }
  }

  return bins;
}

function createEmptyBin(
  timeLabel: string,
  startTime: number,
  firstLineIndex: number,
): LogVolumeBin {
  return {
    timeLabel,
    startTime,
    firstLineIndex,
    error: 0,
    warning: 0,
    notice: 0,
    debug: 0,
    command: 0,
    info: 0,
  };
}

function incrementBinCount(bin: LogVolumeBin, line: ParsedLogLine): void {
  switch (line.markerType) {
    case "error":
      bin.error++;
      break;
    case "warning":
      bin.warning++;
      break;
    case "notice":
      bin.notice++;
      break;
    case "debug":
      bin.debug++;
      break;
    case "command":
      bin.command++;
      break;
    default:
      bin.info++;
  }
}

function isBinEmpty(bin: LogVolumeBin): boolean {
  return (
    bin.error === 0 &&
    bin.warning === 0 &&
    bin.notice === 0 &&
    bin.debug === 0 &&
    bin.command === 0 &&
    bin.info === 0
  );
}
