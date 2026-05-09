import type { LogLevel } from "../schemas";

export const LOG_LEVELS = [
  "error",
  "warning",
  "info",
  "debug",
  "trace",
  "unknown",
] as const satisfies readonly LogLevel[];

export const LOG_LEVEL_EXPR = `
  multiIf(
    SeverityNumber >= 17, 'error',
    SeverityNumber >= 13, 'warning',
    SeverityNumber >= 9, 'info',
    SeverityNumber >= 5, 'debug',
    SeverityNumber >= 1, 'trace',
    lowerUTF8(SeverityText) IN ('fatal', 'error', 'critical'), 'error',
    lowerUTF8(SeverityText) IN ('warn', 'warning'), 'warning',
    lowerUTF8(SeverityText) = 'info', 'info',
    lowerUTF8(SeverityText) = 'debug', 'debug',
    lowerUTF8(SeverityText) = 'trace', 'trace',
    'unknown'
  )
`;
