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
import { buildTriageEventsQuery } from "../sql/events";
import { EXCEPTION_LOG_FILTER_SQL } from "../sql/fingerprint";
import {
  buildOccurrencesQuery,
  buildServicesQuery,
  buildSummaryQuery,
} from "../sql/issues";
import type { SqlClient } from "./client";
import type {
  GetErrorIssueInput,
  ListErrorServicesInput,
  ListErrorTriageEventsInput,
  SearchErrorIssuesInput,
} from "./schemas";
import type {
  ErrorIssueDetail,
  ErrorIssueSummary,
  ErrorIssuesResult,
  ErrorOccurrence,
  ErrorTriageEvent,
} from "./types";
import { isErrorStatus, isErrorTriageEventType } from "./types";

type ErrorIssueSummaryRow = Omit<
  ErrorIssueSummary,
  "occurrenceCount" | "traceCount" | "status" | "regressed"
> & {
  occurrenceCount: string | number;
  traceCount: string | number;
  status?: string;
  regressed?: string | number;
};

type ErrorOccurrenceRow = Omit<ErrorOccurrence, "timestampRank"> & {
  timestampRank?: string | number;
  resourceAttributes: Record<string, string> | null;
  logAttributes: Record<string, string> | null;
  scopeAttributes: Record<string, string> | null;
};

type ServiceRow = { serviceName: string };

type ErrorTriageEventRow = {
  eventId: string;
  eventType: string;
  latestBody: string;
  authorId: string;
  createdAt: string;
  lastUpdatedAt: string;
  latestVersion: string | number;
  latestDeleted: string | number;
};

function mapTriageEvent(row: ErrorTriageEventRow): ErrorTriageEvent | null {
  // Forward event types written by a newer client must not break older readers.
  if (!isErrorTriageEventType(row.eventType)) return null;
  return {
    id: row.eventId,
    type: row.eventType,
    timestamp: row.createdAt,
    updatedAt: row.lastUpdatedAt,
    edited: Number(row.latestVersion) > 0,
    body: row.latestBody,
    // Author name resolves from the user profile at the backend that owns
    // profiles (the web app's server function); the table stores the id only.
    author: { id: row.authorId, name: "" },
  };
}

function mapSummary(row: ErrorIssueSummaryRow): ErrorIssueSummary {
  // Absent without the triage join; a forward status value written by a
  // newer derivation must not break older readers. regressed travels with
  // status: both present or both absent.
  const status = isErrorStatus(row.status) ? row.status : undefined;
  return {
    ...row,
    occurrenceCount: Number(row.occurrenceCount),
    traceCount: Number(row.traceCount),
    status,
    regressed: status === undefined ? undefined : Number(row.regressed) > 0,
  };
}

function mapOccurrence(row: ErrorOccurrenceRow): ErrorOccurrence {
  return {
    ...row,
    timestampRank:
      row.timestampRank === undefined ? 1 : Number(row.timestampRank),
    resourceAttributes: row.resourceAttributes ?? {},
    logAttributes: row.logAttributes ?? {},
    scopeAttributes: row.scopeAttributes ?? {},
  };
}

export interface ErrorsRepositoryOptions {
  tableName?: string;
  /**
   * Derive each Error's triage Status in the summary queries by joining the
   * error_triage_events table (ADR 0004). Opt-in: surfaces without the table
   * (local/desktop, deferred) keep the pre-triage query shape.
   */
  triageEvents?: boolean;
}

export class ErrorsRepository {
  private readonly tableName: string;
  /**
   * Public: the capability travels with the repository, so UI surfaces show
   * status affordances exactly when the summaries they render carry Status.
   */
  readonly triageEvents: boolean;

  constructor(
    private readonly client: SqlClient,
    options: ErrorsRepositoryOptions = {},
  ) {
    this.tableName = options.tableName ?? "logs";
    this.triageEvents = options.triageEvents ?? false;
  }

  async searchIssues(
    input: SearchErrorIssuesInput,
  ): Promise<ErrorIssuesResult> {
    const { sql, params } = buildSummaryQuery(input, this.tableName, {
      triageEvents: this.triageEvents,
    });
    const rows = await this.client.execute<ErrorIssueSummaryRow>(sql, params);
    return { issues: rows.map(mapSummary) };
  }

  async getIssue(input: GetErrorIssueInput): Promise<ErrorIssueDetail> {
    const summaryQuery = buildSummaryQuery(
      {
        fromTs: input.fromTs,
        toTs: input.toTs,
        q: "",
        service: input.service,
        fingerprint: input.fingerprint,
        sort: "lastSeen",
        status: [],
        limit: 1,
        offset: 0,
        attributes: [],
      },
      this.tableName,
      { triageEvents: this.triageEvents },
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
  async listTriageEvents(
    input: ListErrorTriageEventsInput,
  ): Promise<ErrorTriageEvent[]> {
    const { sql, params } = buildTriageEventsQuery(input);
    const rows = await this.client.execute<ErrorTriageEventRow>(sql, params);
    return rows
      .map(mapTriageEvent)
      .filter((event): event is ErrorTriageEvent => event !== null);
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
      // Discovery must see the same rows the issue/services queries do —
      // exception logs only — so we never offer a key that yields no issues.
      rowPredicate: EXCEPTION_LOG_FILTER_SQL,
    });
    const rows = await this.client.execute<AttributeKeyRowRaw>(sql, params);
    return decodeAttributeKeyRows(rows);
  }

  // fallow-ignore-next-line unused-class-member
  async attributeValues(input: AttributeValuesInput): Promise<string[]> {
    const { sql, params } = buildAttributeValuesQuery(input, {
      tableName: this.tableName,
      columnFor: errorsAttributeColumn,
      // Same exception-log scope as the issue queries (see attributeKeys).
      rowPredicate: EXCEPTION_LOG_FILTER_SQL,
    });
    const rows = await this.client.execute<AttributeValueRowRaw>(sql, params);
    return decodeAttributeValueRows(rows);
  }
}

export type ErrorsRepositoryLike = Pick<
  ErrorsRepository,
  | "triageEvents"
  | "searchIssues"
  | "getIssue"
  | "listTriageEvents"
  | "listServices"
  | "attributeKeys"
  | "attributeValues"
>;
