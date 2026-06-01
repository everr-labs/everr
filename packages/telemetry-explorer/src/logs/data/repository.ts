import type { TimeRange } from "@everr/ui/lib/time-range";
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
  LogsTotalsInput,
  LogsTotalsResult,
} from "../schemas";
import {
  type AttributeKeyRowRaw,
  buildAttributeKeysQuery,
  decodeAttributeKeyRows,
} from "../sql/attribute-keys";
import {
  type AttributeValueRowRaw,
  buildAttributeValuesQuery,
  decodeAttributeValueRows,
} from "../sql/attribute-values";
import {
  buildDetailQuery,
  type DetailRowRaw,
  mapDetailRow,
} from "../sql/detail";
import {
  buildExplorerQuery,
  type ExplorerRowRaw,
  mapExplorerRow,
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
import type { SqlClient } from "./client";

export interface LogsRepositoryOptions {
  tableName?: string;
}

export class LogsRepository {
  private readonly tableName: string;

  constructor(
    private readonly client: SqlClient,
    options: LogsRepositoryOptions = {},
  ) {
    this.tableName = options.tableName ?? "logs";
  }

  async explorer(input: LogsExplorerInput): Promise<LogsExplorerResult> {
    const { sql, params } = buildExplorerQuery(input, {
      tableName: this.tableName,
    });
    const rows = await this.client.execute<ExplorerRowRaw>(sql, params);
    return { logs: rows.map(mapExplorerRow) };
  }

  async totals(input: LogsTotalsInput): Promise<LogsTotalsResult> {
    const { sql, params } = buildTotalsQuery(input, {
      tableName: this.tableName,
    });
    const rows = await this.client.execute<TotalsRowRaw>(sql, params);
    return decodeTotalsRows(rows, input.levels);
  }

  // fallow-ignore-next-line unused-class-member
  async histogram(input: LogHistogramInput): Promise<LogHistogramBucket[]> {
    const built = buildHistogramQuery(input, { tableName: this.tableName });
    const rows = await this.client.execute<HistogramRowRaw>(
      built.sql,
      built.params,
    );
    return fillHistogramBuckets(
      rows,
      built.fromDate,
      built.toDate,
      built.intervalSeconds,
    );
  }

  async detail(identity: LogIdentity): Promise<LogDetail> {
    const { sql, params } = buildDetailQuery(identity, {
      tableName: this.tableName,
    });
    const rows = await this.client.execute<DetailRowRaw>(sql, params);
    const row = rows[0];
    if (!row) throw new Error("Log entry not found");
    return mapDetailRow(row);
  }

  // fallow-ignore-next-line unused-class-member
  async filterOptions(input: {
    timeRange: TimeRange;
  }): Promise<LogFilterOptions> {
    const { sql, params } = buildFilterOptionsQuery(input, {
      tableName: this.tableName,
    });
    const rows = await this.client.execute<FilterOptionsRowRaw>(sql, params);
    return decodeFilterOptionsRows(rows);
  }

  async attributeKeys(
    input: LogAttributeKeysInput,
  ): Promise<LogAttributeKey[]> {
    const { sql, params } = buildAttributeKeysQuery(input, {
      tableName: this.tableName,
    });
    const rows = await this.client.execute<AttributeKeyRowRaw>(sql, params);
    return decodeAttributeKeyRows(rows);
  }

  async attributeValues(input: LogAttributeValuesInput): Promise<string[]> {
    const { sql, params } = buildAttributeValuesQuery(input, {
      tableName: this.tableName,
    });
    const rows = await this.client.execute<AttributeValueRowRaw>(sql, params);
    return decodeAttributeValueRows(rows);
  }
}

export type LogsRepositoryLike = Pick<
  LogsRepository,
  | "explorer"
  | "totals"
  | "histogram"
  | "detail"
  | "filterOptions"
  | "attributeKeys"
  | "attributeValues"
>;
