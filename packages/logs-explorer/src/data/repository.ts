import type {
  LogDetail,
  LogFilterOptions,
  LogHistogramBucket,
  LogHistogramInput,
  LogIdentity,
  LogsExplorerInput,
  LogsExplorerResult,
  LogsTotalsInput,
  LogsTotalsResult,
} from "../schemas";
import { buildDetailQuery, mapDetailRow, type DetailRowRaw } from "../sql/detail";
import {
  buildExplorerQuery,
  mapExplorerRow,
  type ExplorerRowRaw,
} from "../sql/explorer";
import {
  buildFilterOptionsQuery,
  decodeFilterOptionsRows,
  type FilterOptionsRowRaw,
} from "../sql/filter-options";
import {
  buildHistogramQuery,
  fillHistogramBuckets,
  type HistogramRowRaw,
} from "../sql/histogram";
import {
  buildTotalsQuery,
  decodeTotalsRows,
  type TotalsRowRaw,
} from "../sql/totals";
import { resolveTimeRange, type TimeRange } from "../time-range";
import type { SqlClient } from "./client";

export class LogsRepository {
  constructor(private readonly client: SqlClient) {}

  async explorer(input: LogsExplorerInput): Promise<LogsExplorerResult> {
    const { sql, params } = buildExplorerQuery(input);
    const rows = await this.client.execute<ExplorerRowRaw>(sql, params);
    return { logs: rows.map(mapExplorerRow) };
  }

  async totals(input: LogsTotalsInput): Promise<LogsTotalsResult> {
    const { sql, params } = buildTotalsQuery(input);
    const rows = await this.client.execute<TotalsRowRaw>(sql, params);
    return decodeTotalsRows(rows, input.levels);
  }

  async histogram(input: LogHistogramInput): Promise<LogHistogramBucket[]> {
    const built = buildHistogramQuery(input);
    const rows = await this.client.execute<HistogramRowRaw>(built.sql, built.params);
    return fillHistogramBuckets(rows, built.fromDate, built.toDate, built.intervalSeconds);
  }

  async detail(identity: LogIdentity): Promise<LogDetail> {
    const { sql, params } = buildDetailQuery(identity);
    const rows = await this.client.execute<DetailRowRaw>(sql, params);
    const row = rows[0];
    if (!row) throw new Error("Log entry not found");
    return mapDetailRow(row);
  }

  async filterOptions(input: { timeRange: TimeRange }): Promise<LogFilterOptions> {
    const { sql, params } = buildFilterOptionsQuery(input);
    const rows = await this.client.execute<FilterOptionsRowRaw>(sql, params);
    return decodeFilterOptionsRows(rows);
  }
}

export type LogsRepositoryLike = Pick<
  LogsRepository,
  "explorer" | "totals" | "histogram" | "detail" | "filterOptions"
>;

export { resolveTimeRange };
