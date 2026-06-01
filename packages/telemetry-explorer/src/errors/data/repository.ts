import type {
  AttributeKey,
  AttributeKeysInput,
  AttributeValuesInput,
} from "../../attribute-filter/schemas";
import {
  type AttributeKeyRowRaw,
  buildAttributeKeysQuery,
  decodeAttributeKeyRows,
} from "../../attribute-filter/sql/keys";
import {
  type AttributeValueRowRaw,
  buildAttributeValuesQuery,
  decodeAttributeValueRows,
} from "../../attribute-filter/sql/values";
import {
  ERRORS_ATTRIBUTE_SOURCES,
  errorsAttributeColumn,
} from "../sql/attribute-columns";
import {
  buildOccurrencesQuery,
  buildServicesQuery,
  buildSummaryQuery,
} from "../sql/issues";
import type { SqlClient } from "./client";
import type {
  GetErrorIssueInput,
  ListErrorServicesInput,
  SearchErrorIssuesInput,
} from "./schemas";
import type {
  ErrorIssueDetail,
  ErrorIssueSummary,
  ErrorIssuesResult,
  ErrorOccurrence,
} from "./types";

type ErrorIssueSummaryRow = Omit<
  ErrorIssueSummary,
  "occurrenceCount" | "traceCount"
> & {
  occurrenceCount: string | number;
  traceCount: string | number;
};

type ErrorOccurrenceRow = ErrorOccurrence & {
  resourceAttributes: Record<string, string> | null;
  logAttributes: Record<string, string> | null;
  scopeAttributes: Record<string, string> | null;
};

type ServiceRow = { serviceName: string };

function mapSummary(row: ErrorIssueSummaryRow): ErrorIssueSummary {
  return {
    ...row,
    occurrenceCount: Number(row.occurrenceCount),
    traceCount: Number(row.traceCount),
  };
}

function mapOccurrence(row: ErrorOccurrenceRow): ErrorOccurrence {
  return {
    ...row,
    resourceAttributes: row.resourceAttributes ?? {},
    logAttributes: row.logAttributes ?? {},
    scopeAttributes: row.scopeAttributes ?? {},
  };
}

export interface ErrorsRepositoryOptions {
  tableName?: string;
}

export class ErrorsRepository {
  private readonly tableName: string;

  constructor(
    private readonly client: SqlClient,
    options: ErrorsRepositoryOptions = {},
  ) {
    this.tableName = options.tableName ?? "logs";
  }

  // fallow-ignore-next-line unused-class-member
  async searchIssues(
    input: SearchErrorIssuesInput,
  ): Promise<ErrorIssuesResult> {
    const { sql, params } = buildSummaryQuery(input, this.tableName);
    const rows = await this.client.execute<ErrorIssueSummaryRow>(sql, params);
    return { issues: rows.map(mapSummary) };
  }

  // fallow-ignore-next-line unused-class-member
  async getIssue(input: GetErrorIssueInput): Promise<ErrorIssueDetail> {
    const summaryQuery = buildSummaryQuery(
      {
        fromTs: input.fromTs,
        toTs: input.toTs,
        q: "",
        service: input.service,
        fingerprint: input.fingerprint,
        sort: "lastSeen",
        limit: 1,
        offset: 0,
        attributes: [],
      },
      this.tableName,
    );
    const occurrencesQuery = buildOccurrencesQuery(input, this.tableName);
    const [summaryRows, occurrenceRows] = await Promise.all([
      this.client.execute<ErrorIssueSummaryRow>(
        summaryQuery.sql,
        summaryQuery.params,
      ),
      this.client.execute<ErrorOccurrenceRow>(
        occurrencesQuery.sql,
        occurrencesQuery.params,
      ),
    ]);

    const summary = summaryRows[0] ? mapSummary(summaryRows[0]) : undefined;
    if (!summary) throw new Error("Error issue not found");

    const occurrences = occurrenceRows.map(mapOccurrence);
    const latest = occurrences[0];
    if (!latest) throw new Error("Error issue not found");

    return { summary, latest, occurrences };
  }

  // fallow-ignore-next-line unused-class-member
  async listServices(input: ListErrorServicesInput): Promise<string[]> {
    const { sql, params } = buildServicesQuery(
      { fromTs: input.fromTs, toTs: input.toTs, attributes: input.attributes },
      this.tableName,
    );
    const rows = await this.client.execute<ServiceRow>(sql, params);
    return rows.map((row) => row.serviceName).filter(Boolean);
  }

  // fallow-ignore-next-line unused-class-member
  async attributeKeys(input: AttributeKeysInput): Promise<AttributeKey[]> {
    const { sql, params } = buildAttributeKeysQuery(input, {
      tableName: this.tableName,
      sources: ERRORS_ATTRIBUTE_SOURCES,
      columnFor: errorsAttributeColumn,
    });
    const rows = await this.client.execute<AttributeKeyRowRaw>(sql, params);
    return decodeAttributeKeyRows(rows);
  }

  // fallow-ignore-next-line unused-class-member
  async attributeValues(input: AttributeValuesInput): Promise<string[]> {
    const { sql, params } = buildAttributeValuesQuery(input, {
      tableName: this.tableName,
      columnFor: errorsAttributeColumn,
    });
    const rows = await this.client.execute<AttributeValueRowRaw>(sql, params);
    return decodeAttributeValueRows(rows);
  }
}

export type ErrorsRepositoryLike = Pick<
  ErrorsRepository,
  | "searchIssues"
  | "getIssue"
  | "listServices"
  | "attributeKeys"
  | "attributeValues"
>;
