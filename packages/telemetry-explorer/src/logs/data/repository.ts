import { queryRows } from "../../sql/client";
import type { TimeRange } from "@everr/ui/lib/time-range";
import {
  AttributeKeyRowRawSchema,
  buildAttributeKeysQuery,
  decodeAttributeKeyRows,
} from "../../attribute-filter/sql/keys";
import {
  AttributeValueRowRawSchema,
  buildAttributeValuesQuery,
  decodeAttributeValueRows,
} from "../../attribute-filter/sql/values";
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
import { LOGS_ATTRIBUTE_SOURCES, logsAttributeColumn } from "../sql/attribute-columns";
import { buildDetailQuery, DetailRowRawSchema, mapDetailRow } from "../sql/detail";
import { buildExplorerQuery, ExplorerRowRawSchema, mapExplorerRow } from "../sql/explorer";
import {
  buildFilterOptionsQuery,
  decodeFilterOptionsRows,
  FilterOptionsRowRawSchema,
} from "../sql/filter-options";
import { buildHistogramQuery, fillHistogramBuckets, HistogramRowRawSchema } from "../sql/histogram";
import { buildTotalsQuery, decodeTotalsRows, TotalsRowRawSchema } from "../sql/totals";
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
    const rows = await queryRows(this.client, ExplorerRowRawSchema, sql, params);
    return { logs: rows.map(mapExplorerRow) };
  }

  async totals(input: LogsTotalsInput): Promise<LogsTotalsResult> {
    const { sql, params } = buildTotalsQuery(input, {
      tableName: this.tableName,
    });
    const rows = await queryRows(this.client, TotalsRowRawSchema, sql, params);
    return decodeTotalsRows(rows, input.levels);
  }

  async histogram(input: LogHistogramInput): Promise<LogHistogramBucket[]> {
    const built = buildHistogramQuery(input, { tableName: this.tableName });
    const rows = await queryRows(this.client, HistogramRowRawSchema, built.sql, built.params);
    return fillHistogramBuckets(rows, built.fromDate, built.toDate, built.intervalSeconds);
  }

  async detail(identity: LogIdentity): Promise<LogDetail> {
    const { sql, params } = buildDetailQuery(identity, {
      tableName: this.tableName,
    });
    const rows = await queryRows(this.client, DetailRowRawSchema, sql, params);
    const row = rows[0];
    if (!row) throw new Error("Log entry not found");
    return mapDetailRow(row);
  }

  // fallow-ignore-next-line unused-class-member
  async filterOptions(input: { timeRange: TimeRange }): Promise<LogFilterOptions> {
    const { sql, params } = buildFilterOptionsQuery(input, {
      tableName: this.tableName,
    });
    const rows = await queryRows(this.client, FilterOptionsRowRawSchema, sql, params);
    return decodeFilterOptionsRows(rows);
  }

  async attributeKeys(input: LogAttributeKeysInput): Promise<LogAttributeKey[]> {
    const { sql, params } = buildAttributeKeysQuery(input, {
      tableName: this.tableName,
      sources: LOGS_ATTRIBUTE_SOURCES,
      columnFor: logsAttributeColumn,
    });
    const rows = await queryRows(this.client, AttributeKeyRowRawSchema, sql, params);
    return decodeAttributeKeyRows(rows);
  }

  async attributeValues(input: LogAttributeValuesInput): Promise<string[]> {
    const { sql, params } = buildAttributeValuesQuery(input, {
      tableName: this.tableName,
      columnFor: logsAttributeColumn,
    });
    const rows = await queryRows(this.client, AttributeValueRowRawSchema, sql, params);
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
