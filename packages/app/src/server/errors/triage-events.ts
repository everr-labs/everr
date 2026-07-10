import { randomUUID } from "node:crypto";
import {
  ERROR_TRIAGE_EVENTS_TABLE,
  type ErrorStatusEventType,
  type ErrorTriageEventType,
} from "@everr/telemetry-explorer/errors";
import type { ClickhouseQuery } from "@/lib/clickhouse";
import { insertAdminRows } from "@/lib/clickhouse";

// Write path for error triage entries (ADR 0004): append-only version rows in
// app.error_triage_events. An edit or delete appends version + 1 for the same
// event_id; ReplacingMergeTree physically drops superseded versions at merge
// time, which is what keeps erasure cheap. event_time is reused verbatim
// across versions: it is the timeline order key and it pins all versions of
// an entry into the same partition so they can collapse.
// Inserts run as the admin user outside the tenant-scoped session, so the
// table name is database-qualified here.
const QUALIFIED_EVENTS_TABLE = `app.${ERROR_TRIAGE_EVENTS_TABLE}`;

// Uniform not-found error for missing, deleted, foreign-author, and
// non-investigation entries alike, so the write surface leaks no existence
// information across those cases.
export const INVESTIGATION_NOT_FOUND = "Investigation not found";

interface ErrorTriageEventRow {
  tenant_id: string;
  fingerprint: string;
  event_id: string;
  version: number;
  event_type: ErrorTriageEventType;
  body: string;
  author_id: string;
  deleted: 0 | 1;
  event_time: string;
  updated_at: string;
}

function insertTriageEvents(rows: ErrorTriageEventRow[]): Promise<void> {
  return insertAdminRows(QUALIFIED_EVENTS_TABLE, rows, {
    date_time_input_format: "best_effort",
  });
}

async function createEntry(input: {
  tenantId: string;
  fingerprint: string;
  eventType: ErrorTriageEventType;
  body: string;
  authorId: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await insertTriageEvents([
    {
      tenant_id: input.tenantId,
      fingerprint: input.fingerprint,
      event_id: randomUUID(),
      version: 0,
      event_type: input.eventType,
      body: input.body,
      author_id: input.authorId,
      deleted: 0,
      event_time: now,
      updated_at: now,
    },
  ]);
}

export function createInvestigation(input: {
  tenantId: string;
  fingerprint: string;
  body: string;
  authorId: string;
}): Promise<void> {
  return createEntry({ ...input, eventType: "investigation" });
}

// Status changes (resolved, ignored, reopened) are plain version-0 entries in
// the same table; Status is derived at read time from the latest one, so
// "changing status" is just appending an event.
export function createStatusEvent(input: {
  tenantId: string;
  fingerprint: string;
  type: ErrorStatusEventType;
  body: string;
  authorId: string;
}): Promise<void> {
  return createEntry({
    tenantId: input.tenantId,
    fingerprint: input.fingerprint,
    eventType: input.type,
    body: input.body,
    authorId: input.authorId,
  });
}

type LatestEntryRow = {
  entryFingerprint: string;
  eventType: string;
  authorId: string;
  latestVersion: string | number;
  latestDeleted: string | number;
  createdAt: string;
};

// Latest version of one entry, read through the tenant-scoped query (row
// policy applies), so a foreign tenant's event_id resolves to nothing.
// Aliases deliberately avoid source column names: ClickHouse resolves
// identifiers inside aggregates to same-name SELECT aliases.
async function getLatestEntry(
  query: ClickhouseQuery,
  eventId: string,
): Promise<LatestEntryRow | undefined> {
  const rows = await query<LatestEntryRow>(
    `
      SELECT
        argMax(fingerprint, version) AS entryFingerprint,
        argMax(event_type, version) AS eventType,
        argMax(author_id, version) AS authorId,
        max(version) AS latestVersion,
        argMax(deleted, version) AS latestDeleted,
        toString(min(event_time)) AS createdAt
      FROM ${ERROR_TRIAGE_EVENTS_TABLE}
      WHERE event_id = {eventId:UUID}
      GROUP BY event_id
    `,
    { eventId },
  );
  return rows[0];
}

// Author-only, investigation-only: resolves the latest version, verifies the
// session user wrote it, and appends the next version.
async function appendInvestigationVersion(input: {
  query: ClickhouseQuery;
  tenantId: string;
  eventId: string;
  authorId: string;
  next: { body: string; deleted: 0 | 1 };
}): Promise<void> {
  const latest = await getLatestEntry(input.query, input.eventId);
  if (
    !latest ||
    Number(latest.latestDeleted) === 1 ||
    latest.eventType !== "investigation" ||
    latest.authorId !== input.authorId
  ) {
    throw new Error(INVESTIGATION_NOT_FOUND);
  }

  await insertTriageEvents([
    {
      tenant_id: input.tenantId,
      fingerprint: latest.entryFingerprint,
      event_id: input.eventId,
      version: Number(latest.latestVersion) + 1,
      event_type: "investigation",
      body: input.next.body,
      author_id: latest.authorId,
      deleted: input.next.deleted,
      event_time: latest.createdAt,
      updated_at: new Date().toISOString(),
    },
  ]);
}

export function editInvestigation(input: {
  query: ClickhouseQuery;
  tenantId: string;
  eventId: string;
  authorId: string;
  body: string;
}): Promise<void> {
  return appendInvestigationVersion({
    query: input.query,
    tenantId: input.tenantId,
    eventId: input.eventId,
    authorId: input.authorId,
    next: { body: input.body, deleted: 0 },
  });
}

export function deleteInvestigation(input: {
  query: ClickhouseQuery;
  tenantId: string;
  eventId: string;
  authorId: string;
}): Promise<void> {
  return appendInvestigationVersion({
    query: input.query,
    tenantId: input.tenantId,
    eventId: input.eventId,
    authorId: input.authorId,
    // Body is emptied on delete so no content survives in the latest version;
    // superseded versions drop at merge (OPTIMIZE FINAL for hard deadlines).
    next: { body: "", deleted: 1 },
  });
}
