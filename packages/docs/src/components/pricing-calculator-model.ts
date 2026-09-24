export const EVERR_PRICING = {
  baseEur: 39,
  includedIngestionGb: 300,
  overageEurPerGb: 0.1,
  includedUptimeMonitors: 10,
  additionalMonitorEur: 1,
} as const;

export function calculateEverrCharges({
  ingestionGb,
  uptimeMonitors,
}: {
  ingestionGb: number;
  uptimeMonitors: number;
}) {
  const ingestionOverageEur =
    Math.max(0, ingestionGb - EVERR_PRICING.includedIngestionGb) *
    EVERR_PRICING.overageEurPerGb;
  const uptimeMonitorsEur =
    Math.max(0, uptimeMonitors - EVERR_PRICING.includedUptimeMonitors) *
    EVERR_PRICING.additionalMonitorEur;

  return {
    baseEur: EVERR_PRICING.baseEur,
    ingestionOverageEur,
    uptimeMonitorsEur,
    totalEur: EVERR_PRICING.baseEur + ingestionOverageEur + uptimeMonitorsEur,
  };
}
