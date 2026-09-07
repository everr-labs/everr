import type { ChartConfig } from "./chart";

export function ChartEmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-75 items-center justify-center text-muted-foreground text-sm">
      {message}
    </div>
  );
}

export function formatChartDate(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function createChartTooltipFormatter(
  config: ChartConfig,
  valueFormatter?: (value: number, name: string | number) => string,
) {
  return (
    value: string | number | (string | number)[],
    name: string | number,
  ) => (
    <>
      <div
        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style={{
          backgroundColor: `var(--color-${String(name)})`,
        }}
      />
      <span className="text-muted-foreground">
        {config[String(name) as keyof typeof config]?.label}
      </span>
      <span className="font-mono font-medium tabular-nums ml-auto">
        {valueFormatter ? valueFormatter(value as number, name) : value}
      </span>
    </>
  );
}

/**
 * Build a tooltip label formatter that reads a timestamp off the hovered
 * payload row. `key` is the row field holding the ISO string (default "date");
 * `withTime` includes the time of day (for intraday series like per-minute or
 * per-hour points) instead of just the calendar date.
 */
export function createChartTooltipLabelFormatter(
  key = "date",
  { withTime = false }: { withTime?: boolean } = {},
) {
  return (
    _: unknown,
    payload: Array<{ payload?: Record<string, unknown> }>,
  ) => {
    const raw = payload?.[0]?.payload?.[key];
    if (typeof raw !== "string") return "";
    const d = new Date(raw);
    return withTime ? d.toLocaleString() : d.toLocaleDateString();
  };
}

/** The common case: a `date` field, formatted as a calendar date. */
export const chartTooltipLabelFormatter = createChartTooltipLabelFormatter();

export function createLegendFormatter(config: ChartConfig) {
  return (value: string) =>
    config[value as keyof typeof config]?.label ?? value;
}
