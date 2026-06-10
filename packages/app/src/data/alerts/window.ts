const WINDOW_RE = /^(\d+)([smhd])$/;

const UNITS = {
  s: { seconds: 1, name: "SECOND" },
  m: { seconds: 60, name: "MINUTE" },
  h: { seconds: 3600, name: "HOUR" },
  d: { seconds: 86400, name: "DAY" },
} as const;

export interface ParsedWindow {
  seconds: number;
  interval: string;
}

export function parseWindow(value: string): ParsedWindow {
  const match = WINDOW_RE.exec(value);
  if (!match) {
    throw new Error(
      `invalid window "${value}": expected <integer><s|m|h|d>, e.g. "5m"`,
    );
  }

  const amount = Number(match[1]);
  const unit = UNITS[match[2] as keyof typeof UNITS];
  if (amount <= 0) {
    throw new Error(`invalid window "${value}": must be positive`);
  }

  return {
    seconds: amount * unit.seconds,
    interval: `${amount} ${unit.name}`,
  };
}

export function parseEvaluationInterval(value: string): ParsedWindow {
  const parsed = parseWindow(value);
  if (parsed.seconds < 60) {
    throw new Error(
      `invalid evaluationInterval "${value}": must be at least 1m`,
    );
  }
  return parsed;
}
