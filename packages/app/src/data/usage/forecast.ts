import type { SignalCounts } from "./pricing";
import type { CurrentPeriodUsage } from "./schemas";

/**
 * Linear projection of month-to-date usage to the end of the billing period:
 * the average ingest rate so far, extended over the full period. Early in the
 * month a single burst skews this heavily — it's an estimate, not a quote.
 */
export function projectToPeriodEnd(usage: CurrentPeriodUsage): SignalCounts {
  const elapsed = Date.parse(usage.now) - Date.parse(usage.periodStart);
  const period = Date.parse(usage.periodEnd) - Date.parse(usage.periodStart);
  if (elapsed <= 0) return { ...usage.totals };
  const factor = period / elapsed;
  return {
    logs: usage.totals.logs * factor,
    spans: usage.totals.spans * factor,
    metrics: usage.totals.metrics * factor,
  };
}
