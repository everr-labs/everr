import type {
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
  TimeRange,
} from "@everr/telemetry-explorer/logs";
import {
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
};
