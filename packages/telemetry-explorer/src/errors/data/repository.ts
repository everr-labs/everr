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
  buildTriageEventsQuery,
  buildTriageStatusesQuery,
} from "../sql/events";
import { EXCEPTION_LOG_FILTER_SQL } from "../sql/fingerprint";
import {
  buildOccurrencesQuery,
  buildServicesQuery,
  buildSummaryQuery,
} from "../sql/issues";
import { ERRORS_LOGS_TABLE } from "../sql/table";
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
  ErrorTriageStatus,
} from "./types";
import {
  isErrorStatus,
  isErrorStatusEventType,
  isErrorTriageEventType,
} from "./types";

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

type ErrorTriageStatusRow = {
  fingerprint: string;
  lastStatusType: string;
  lastStatusAt: string;
  resolvedVersions: string[];
};

function mapTriageStatus(row: ErrorTriageStatusRow): ErrorTriageStatus | null {
  // A forward status type written by a newer client derives as open, exactly
  // as it did when the derivation lived in SQL.
  if (!isErrorStatusEventType(row.lastStatusType)) return null;
  return {
    fingerprint: row.fingerprint,
    type: row.lastStatusType,
    at: row.lastStatusAt,
    resolvedVersions: row.resolvedVersions,
  };
}

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
   * Read the error_triage_events table (ADR 0004) ahead of the summary
   * queries and derive each Error's triage Status from it. Opt-in: surfaces
   * without the table (local/desktop, deferred) keep the pre-triage query
   * shape.
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
    this.tableName = options.tableName ?? ERRORS_LOGS_TABLE;
    this.triageEvents = options.triageEvents ?? false;
  }

  // The triage state is read first (a scan of the small events table) and
  // handed to the summary query as parameters, so deriving Status and the
  // Regression flag adds no join and no extra logs scan (spec 0001).
  // undefined when the surface has no triage capability.
  private async fetchTriageStatuses(
    fingerprint: string,
  ): Promise<ErrorTriageStatus[] | undefined> {
    if (!this.triageEvents) return undefined;
    const { sql, params } = buildTriageStatusesQuery({ fingerprint });
    const rows = await this.client.execute<ErrorTriageStatusRow>(sql, params);
    return rows
      .map(mapTriageStatus)
      .filter((status): status is ErrorTriageStatus => status !== null);
  }

  async searchIssues(
    input: SearchErrorIssuesInput,
  ): Promise<ErrorIssuesResult> {
    const triageStatuses = await this.fetchTriageStatuses(input.fingerprint);
    const { sql, params } = buildSummaryQuery(input, this.tableName, {
      triageStatuses,
    });
    const rows = await this.client.execute<ErrorIssueSummaryRow>(sql, params);
    return { issues: rows.map(mapSummary) };
  }

  async getIssue(input: GetErrorIssueInput): Promise<ErrorIssueDetail> {
    // The occurrences query is independent of the triage state, so it runs
    // concurrently with the statuses fetch the summary query waits on.
    const occurrencesQuery = buildOccurrencesQuery(input, this.tableName);
    const occurrencesPromise = this.client.execute<ErrorOccurrenceRow>(
      occurrencesQuery.sql,
      occurrencesQuery.params,
    );
    const triageStatuses = await this.fetchTriageStatuses(input.fingerprint);
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
      { triageStatuses },
    );
    const [summaryRows, occurrenceRows] = await Promise.all([
      this.client.execute<ErrorIssueSummaryRow>(
        summaryQuery.sql,
        summaryQuery.params,
      ),
      occurrencesPromise,
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
