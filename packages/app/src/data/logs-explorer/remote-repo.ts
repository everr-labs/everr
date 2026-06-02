import type {
  LogAttributeKey,
  LogAttributeKeysInput,
  LogAttributeValuesInput,
  LogDetail,
  LogFilterOptions,
  LogHistogramBucket,
  LogHistogramInput,
  LogIdentity,
  LogsExplorerInput,
  LogsExplorerResult,
  LogsRepositoryLike,
  LogsTotalsInput,
  LogsTotalsResult,
} from "@everr/telemetry-explorer/logs";
import type { TimeRange } from "@everr/ui/lib/time-range";
import {
  getLogAttributeKeys,
  getLogAttributeValues,
  getLogDetail,
  getLogFilterOptions,
  getLogsExplorer,
  getLogsHistogram,
  getLogsTotals,
} from "./server";

export const remoteRepo: LogsRepositoryLike = {
  explorer: (input: LogsExplorerInput): Promise<LogsExplorerResult> =>
    getLogsExplorer({ data: input }),
  totals: (input: LogsTotalsInput): Promise<LogsTotalsResult> =>
    getLogsTotals({ data: input }),
  histogram: (input: LogHistogramInput): Promise<LogHistogramBucket[]> =>
    getLogsHistogram({ data: input }),
  detail: (identity: LogIdentity): Promise<LogDetail> =>
    getLogDetail({ data: identity }),
  filterOptions: (input: { timeRange: TimeRange }): Promise<LogFilterOptions> =>
    getLogFilterOptions({ data: input }),
  attributeKeys: (input: LogAttributeKeysInput): Promise<LogAttributeKey[]> =>
    getLogAttributeKeys({ data: input }),
  attributeValues: (input: LogAttributeValuesInput): Promise<string[]> =>
    getLogAttributeValues({ data: input }),
};
