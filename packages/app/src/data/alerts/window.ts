const WINDOW_RE = /^(\d+)([smhd])$/;

const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

function parseDurationSeconds(
  value: string,
  name: string,
  minAmount: number,
): number {
  const match = WINDOW_RE.exec(value);
  if (!match) {
    throw new Error(
      `invalid ${name} "${value}": expected <integer><s|m|h|d>, e.g. "5m"`,
    );
  }

  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount < minAmount) {
    throw new Error(
      `invalid ${name} "${value}": must be ${minAmount === 0 ? "non-negative" : "positive"}`,
    );
  }

  const seconds = amount * UNIT_SECONDS[match[2] as keyof typeof UNIT_SECONDS];
  if (!Number.isSafeInteger(seconds)) {
    throw new Error(`invalid ${name} "${value}": value is too large`);
  }

  return seconds;
}

export function parseWindow(value: string): number {
  return parseDurationSeconds(value, "window", 1);
}

/** `spec.for` duration → seconds. Unlike a window, "0s" (fire immediately) is valid. */
export function parseForDuration(value: string): number {
  return parseDurationSeconds(value, "for duration", 0);
}

/**
 * Seconds → canonical duration string, using the largest unit that divides
 * evenly ("300" → "5m", "86400" → "1d", "90" → "90s", "0" → "0s"). Inverse of
 * the parsers above for any value they can produce.
 */
export function formatDurationSeconds(seconds: number): string {
  if (seconds > 0) {
    for (const unit of ["d", "h", "m"] as const) {
      const size = UNIT_SECONDS[unit];
      if (seconds % size === 0) return `${seconds / size}${unit}`;
    }
  }
  return `${seconds}s`;
}

export function parseEvaluationInterval(value: string): number {
  const seconds = parseWindow(value);
  if (seconds < 60) {
    throw new Error(
      `invalid evaluationInterval "${value}": must be at least 1m`,
    );
  }
  return seconds;
}
