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

  const seconds = amount * UNIT_SECONDS[match[2] as keyof typeof UNIT_SECONDS];
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
