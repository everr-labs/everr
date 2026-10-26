import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  MEMBERSHIP_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  USER_SYNC_TASK,
  relatedSyncSpec,
  userSyncSpec,
} from "./commands";

export class CrmAdmissionDeferred extends Error {}

const phases = ["user", "organization", "member", "projection", "completed"] as const;
type Phase = (typeof phases)[number];
type Progress = {
  scan_id: string;
  phase: Phase;
  cursor: string | null;
  cursor_kind: string | null;
  admitted: number;
  pages: number;
  updated_at?: Date;
};
type Source = {
  id: string;
  kind: "user" | "organization" | "membership";
  user_id: string | null;
  organization_id: string | null;
  recheck?: number | null;
  verify?: number | null;
};

async function sourcePage(client: PoolClient, deployment: string, state: Progress, limit: number) {
  if (state.phase === "projection") {
    return (
      await client.query<Source>(
        `SELECT source_id AS id, kind, user_id, organization_id,
        CASE WHEN desired->>'deleted' = 'true' AND synced_revision = desired_revision
          THEN desired_revision END AS recheck,
        CASE WHEN desired->>'deleted' <> 'true' AND synced_revision = desired_revision
          THEN desired_revision END AS verify
       FROM crm_projection WHERE deployment = $1
       AND ($2::text IS NULL OR (kind, source_id) > ($2, $3))
       ORDER BY kind, source_id LIMIT $4`,
        [deployment, state.cursor_kind, state.cursor, limit],
      )
    ).rows;
  }
  // Fixed table names only. Each source uses its immutable primary-key ordering.
  const query =
    state.phase === "member"
      ? `SELECT id, 'membership' AS kind, user_id, organization_id FROM member`
      : state.phase === "user"
        ? `SELECT id, 'user' AS kind, id AS user_id, NULL AS organization_id FROM "user"`
        : `SELECT id, 'organization' AS kind, NULL AS user_id, id AS organization_id FROM organization`;
  return (
    await client.query<Source>(
      `${query} WHERE ($1::text IS NULL OR id > $1) ORDER BY id LIMIT $2`,
      [state.cursor, limit],
    )
  ).rows;
}

async function admit(
  client: PoolClient,
  row: Source,
  state: Progress,
  periodic: boolean,
  deployment: string,
) {
  if ((row.kind !== "user" && !row.organization_id) || (row.kind === "membership" && !row.user_id))
    throw new Error("Invalid CRM bootstrap endpoints.");
  const spec =
    row.kind === "user"
      ? userSyncSpec(row.id)
      : relatedSyncSpec(
          row.organization_id ?? "",
          row.kind === "membership" ? (row.user_id ?? "") : undefined,
        );
  if (periodic) {
    // Retained failures must reach the authoritative reader: a lost notification
    // may cover a newer source revision. Unchanged work keeps its durable allowance.
    const existing = await client.query(
      "SELECT id FROM graphile_worker.jobs WHERE key = $1 AND attempts < max_attempts",
      [spec.jobKey],
    );
    if (existing.rows.length) return false;
    // Source and retained-identity passes both verify completed work. An earlier
    // source admission may otherwise coalesce away the retained pass's check.
    const completed = await client.query<{
      revision: number;
      deleted: boolean;
      remote_check_id: string | null;
    }>(
      `SELECT desired_revision AS revision, (desired->>'deleted')::boolean AS deleted, remote_check_id
       FROM crm_projection WHERE deployment = $1 AND kind = $2 AND source_id = $3
       AND synced_revision = desired_revision`,
      [
        deployment,
        row.kind,
        row.kind === "membership" ? JSON.stringify([row.user_id, row.organization_id]) : row.id,
      ],
    );
    if (completed.rows[0]?.remote_check_id === state.scan_id) return false;
    if (completed.rows[0]) {
      row.verify = completed.rows[0].deleted ? null : completed.rows[0].revision;
      row.recheck = completed.rows[0].deleted ? completed.rows[0].revision : null;
    }
  }
  const payload = {
    version: 1,
    eventId: state.scan_id,
    eventType: periodic ? "crm.reconciliation.requested" : "crm.bootstrap.requested",
    occurredAt: new Date().toISOString(),
    ...(periodic && row.verify ? { verifyRemoteRevision: row.verify } : {}),
    ...(row.recheck ? { recheckDeletionRevision: row.recheck } : {}),
    ...(row.kind === "user"
      ? { userId: row.id }
      : {
          kind: row.kind,
          organizationId: row.organization_id,
          ...(row.kind === "membership" ? { userId: row.user_id } : {}),
        }),
  };
  const task =
    row.kind === "user"
      ? USER_SYNC_TASK
      : row.kind === "organization"
        ? ORGANIZATION_SYNC_TASK
        : MEMBERSHIP_SYNC_TASK;
  const result = await client.query<{ id: string | null }>(
    `SELECT (graphile_worker.add_job($1, $2::json, queue_name := $3,
      max_attempts := $4, job_key := $5, job_key_mode := $6, priority := $7)).id AS id`,
    [
      task,
      JSON.stringify(payload),
      spec.queueName,
      spec.maxAttempts,
      spec.jobKey,
      spec.jobKeyMode,
      0,
    ],
  );
  if (!result.rows[0]?.id) throw new Error("CRM bootstrap admission failed.");
  return true;
}

/** Short source/admission transactions only, with no provider dependency. A committed
 * cursor always covers durable coalesced jobs. Current snapshots belong to workers.
 * A later full scan covers inserts behind an earlier cursor or lost live events.
 */
export async function bootstrapCrm(options: {
  pool: Pick<Pool, "connect">;
  mode: "disabled" | "paused" | "configured";
  deployment: string;
  accountScope: string;
  pageSize: number;
  maxPages: number;
  newScan?: boolean;
  signal?: AbortSignal;
  /** Internal periodic admission uses its own checkpoint and never admits while paused. */
  periodic?: boolean;
}) {
  if (options.mode === "disabled") throw new Error("CRM bootstrap is disabled; no work admitted.");
  if (!options.deployment.trim() || !options.accountScope.trim())
    throw new Error("CRM bootstrap requires stable deployment and account scope.");
  if (
    !Number.isInteger(options.pageSize) ||
    options.pageSize < 1 ||
    options.pageSize > 100 ||
    !Number.isInteger(options.maxPages) ||
    options.maxPages < 1 ||
    options.maxPages > 1000
  )
    throw new Error("CRM bootstrap requires pageSize 1..100 and maxPages 1..1000.");
  const periodic = options.periodic === true;
  if (periodic && options.mode !== "configured") throw new CrmAdmissionDeferred("paused");
  const table = periodic ? "crm_reconciliation" : "crm_bootstrap";
  let progress: Progress | undefined;
  for (let page = 0; page < options.maxPages; page++) {
    options.signal?.throwIfAborted();
    const client = await options.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '15s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      const hash = createHash("sha256")
        .update(JSON.stringify([table, options.deployment, options.accountScope]))
        .digest();
      const lock = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock($1::int, $2::int) AS acquired",
        [hash.readInt32BE(0), hash.readInt32BE(4)],
      );
      if (!lock.rows[0].acquired) throw new Error("CRM bootstrap is already admitting a page.");
      const scope = [options.deployment, options.accountScope];
      if (periodic) {
        const backlog = await client.query<{ count: string }>(
          "SELECT count(*) FROM graphile_worker.jobs WHERE task_identifier IN ('crm/sync-user', 'crm/sync-organization', 'crm/sync-membership') AND attempts < max_attempts",
        );
        if (Number(backlog.rows[0].count) >= 100) {
          throw new CrmAdmissionDeferred("backlog");
        }
      }
      await client.query(
        `INSERT INTO ${table}(deployment, account_scope, scan_id, phase)
         VALUES ($1, $2, $3, 'user') ON CONFLICT DO NOTHING`,
        [...scope, randomUUID()],
      );
      progress = (
        await client.query<Progress>(
          `SELECT scan_id, phase, cursor, cursor_kind, admitted, pages, updated_at FROM ${table} WHERE deployment = $1 AND account_scope = $2 FOR UPDATE`,
          scope,
        )
      ).rows[0];
      if (
        page === 0 &&
        (options.newScan ||
          (periodic &&
            progress.phase === "completed" &&
            Date.now() - new Date(progress.updated_at ?? 0).getTime() >= 86400_000))
      ) {
        if (progress.phase !== "completed")
          throw new Error("Complete the current CRM bootstrap before starting a new scan.");
        progress = {
          scan_id: randomUUID(),
          phase: "user",
          cursor: null,
          cursor_kind: null,
          admitted: 0,
          pages: 0,
        };
        await client.query(
          `UPDATE ${table} SET started_at = now() WHERE deployment = $1 AND account_scope = $2`,
          scope,
        );
      }
      if (progress.phase !== "completed") {
        const rows = await sourcePage(client, options.deployment, progress, options.pageSize);
        let admitted = 0;
        for (const row of rows) {
          options.signal?.throwIfAborted();
          if (await admit(client, row, progress, periodic, options.deployment)) admitted++;
        }
        const last = rows.at(-1);
        progress = {
          ...progress,
          phase: last ? progress.phase : phases[phases.indexOf(progress.phase) + 1],
          cursor: last?.id ?? null,
          cursor_kind: last && progress.phase === "projection" ? last.kind : null,
          admitted: progress.admitted + admitted,
          pages: progress.pages + 1,
        };
        await client.query(
          `UPDATE ${table} SET scan_id = $3, phase = $4, cursor = $5,
           cursor_kind = $6, admitted = $7, pages = $8, updated_at = now()
           WHERE deployment = $1 AND account_scope = $2`,
          [
            ...scope,
            progress.scan_id,
            progress.phase,
            progress.cursor,
            progress.cursor_kind,
            progress.admitted,
            progress.pages,
          ],
        );
      }
      options.signal?.throwIfAborted();
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (progress.phase === "completed") break;
  }
  if (!progress) throw new Error("CRM bootstrap made no progress.");
  return {
    scan_id: progress.scan_id,
    phase: progress.phase,
    cursor: progress.cursor,
    cursor_kind: progress.cursor_kind,
    admitted: progress.admitted,
    pages: progress.pages,
    admissionCompleted: progress.phase === "completed",
    remoteConverged: false as const,
  };
}
