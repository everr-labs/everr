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
    lower(SeverityText) IN ('fatal', 'error', 'critical'), 'error',
    lower(SeverityText) IN ('warn', 'warning'), 'warning',
    lower(SeverityText) = 'info', 'info',
    lower(SeverityText) = 'debug', 'debug',
    lower(SeverityText) = 'trace', 'trace',
    'unknown'
  )
`;
