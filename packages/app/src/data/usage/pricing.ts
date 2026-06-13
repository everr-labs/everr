/**
 * ─── PRICING KNOBS ─────────────────────────────────────────────────────────
 * Ingestion list prices, in USD per MILLION ingested items. Everything on the
 * usage page (stat cards, forecast, historical bars, breakdown table) derives
 * from these three numbers — tweak them to play with pricing scenarios.
 */
export const USAGE_PRICING = {
  /** $ per 1M metric datapoints (gauge/sum/histogram/exp-histogram/summary). */
  metricsPerMillion: 0.15,
  /** $ per 1M log records. */
  logsPerMillion: 0.45,
  /** $ per 1M spans. */
  spansPerMillion: 0.45,
} as const;

export interface SignalCounts {
  logs: number;
  spans: number;
  metrics: number;
}

export interface SignalCosts extends SignalCounts {
  total: number;
}

export function usageCosts(counts: SignalCounts): SignalCosts {
  const logs = (counts.logs / 1e6) * USAGE_PRICING.logsPerMillion;
  const spans = (counts.spans / 1e6) * USAGE_PRICING.spansPerMillion;
  const metrics = (counts.metrics / 1e6) * USAGE_PRICING.metricsPerMillion;
  return { logs, spans, metrics, total: logs + spans + metrics };
}

export function formatUsd(value: number): string {
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatCount(value: number): string {
  return Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
