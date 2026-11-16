import type { LogLevel } from "../schemas";

export { LOG_LEVELS } from "../sql/level-expr";

export const PAGE_SIZE = 200;
export const DEFAULT_HISTOGRAM_BUCKETS = 80;

export const LOG_LEVEL_META = {
  error: {
    label: "Error",
    chartColor: "var(--destructive)",
    dotClassName: "bg-destructive",
    badgeClassName: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  warning: {
    label: "Warning",
    chartColor: "var(--warning)",
    dotClassName: "bg-warning",
    badgeClassName: "border-warning/40 bg-warning/10 text-warning",
  },
  info: {
    label: "Info",
    chartColor: "var(--info)",
    dotClassName: "bg-info",
    badgeClassName: "border-info/40 bg-info/10 text-info",
  },
  debug: {
    label: "Debug",
    chartColor: "var(--level-debug)",
    dotClassName: "bg-level-debug",
    badgeClassName: "border-level-debug/40 bg-level-debug/10 text-level-debug",
  },
  trace: {
    label: "Trace",
    chartColor: "var(--level-trace)",
    dotClassName: "bg-level-trace",
    badgeClassName: "border-level-trace/40 bg-level-trace/10 text-level-trace",
  },
  unknown: {
    label: "Unknown",
    chartColor: "var(--muted-foreground)",
    dotClassName: "bg-muted-foreground",
    badgeClassName: "border-border bg-muted/50 text-muted-foreground",
  },
} satisfies Record<
  LogLevel,
  {
    label: string;
    chartColor: string;
    dotClassName: string;
    badgeClassName: string;
  }
>;
