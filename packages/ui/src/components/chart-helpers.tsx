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
  return (value: string | number | (string | number)[], name: string | number) => (
    <>
      <div
        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style={{
          backgroundColor: `var(--color-${String(name)})`,
        }}
      />
      <span className="text-muted-foreground">{config[String(name)]?.label}</span>
      <span className="font-mono font-medium tabular-nums ml-auto">
        {/* oxlint-disable-next-line typescript/consistent-type-assertions -- recharts hands the tooltip a numeric value here, but its formatter type widens to string | number | array which valueFormatter's number contract can't express */}
        {valueFormatter ? valueFormatter(value as number, name) : value}
      </span>
    </>
  );
}

export function chartTooltipLabelFormatter(
  _: unknown,
  payload: Array<{ payload?: { date?: string } }>,
) {
  if (payload?.[0]?.payload?.date) {
    return new Date(payload[0].payload.date).toLocaleDateString();
  }
  return "";
}

export function createLegendFormatter(config: ChartConfig) {
  return (value: string) => config[value]?.label ?? value;
}
