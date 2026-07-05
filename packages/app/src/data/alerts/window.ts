const WINDOW_RE = /^(\d+)([smhd])$/;

const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 } as const;

export function parseWindow(value: string): number {
  const match = WINDOW_RE.exec(value);
  if (!match) {
    throw new Error(`invalid window "${value}": expected <integer><s|m|h|d>, e.g. "5m"`);
  }

  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`invalid window "${value}": must be positive`);
  }

  const unit = match[2];
  if (unit !== "s" && unit !== "m" && unit !== "h" && unit !== "d") {
    throw new Error(`invalid window "${value}": expected <integer><s|m|h|d>, e.g. "5m"`);
  }
  const seconds = amount * UNIT_SECONDS[unit];
  if (!Number.isSafeInteger(seconds)) {
    throw new Error(`invalid window "${value}": value is too large`);
  }

  return seconds;
}

export function parseEvaluationInterval(value: string): number {
  const seconds = parseWindow(value);
  if (seconds < 60) {
    throw new Error(`invalid evaluationInterval "${value}": must be at least 1m`);
  }
  return seconds;
}
