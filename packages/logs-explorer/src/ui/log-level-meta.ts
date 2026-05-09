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
    chartColor: "var(--color-amber-500)",
    dotClassName: "bg-amber-500",
    badgeClassName: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  },
  info: {
    label: "Info",
    chartColor: "var(--color-sky-500)",
    dotClassName: "bg-sky-500",
    badgeClassName: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  },
  debug: {
    label: "Debug",
    chartColor: "var(--color-violet-500)",
    dotClassName: "bg-violet-500",
    badgeClassName: "border-violet-500/40 bg-violet-500/10 text-violet-500",
  },
  trace: {
    label: "Trace",
    chartColor: "var(--color-emerald-500)",
    dotClassName: "bg-emerald-500",
    badgeClassName: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
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
