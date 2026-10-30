import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import {
  FULL_SYNC_TASK,
  USER_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  MEMBERSHIP_SYNC_TASK,
  fullSyncSpec,
  userSyncSpec,
  relatedSyncSpec,
} from "../src/crm/commands";

async function main() {
  const { values } = parseArgs({
    options: {
      "user-id": { type: "string" },
      "organization-id": { type: "string" },
      prune: { type: "boolean", default: false },
      apply: { type: "boolean", default: false },
    },
  });
  if (process.env.CRM_BREVO_MODE !== "configured") throw new Error("CRM is not configured.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required.");
  const userId = values["user-id"];
  const organizationId = values["organization-id"];
  if ([userId, organizationId].some((id) => id !== undefined && (!id.trim() || id.length > 512)))
    throw new Error("Invalid CRM source ID.");
  if (
    (values.apply && !values.prune) ||
    ((userId || organizationId) && (values.prune || values.apply))
  )
    throw new Error("Invalid CRM sync options.");
  const eventId = randomUUID();
  const origin = {
    version: 1,
    eventId,
    eventType: "crm.manual-sync.requested",
    occurredAt: new Date().toISOString(),
  };
  const task =
    userId && organizationId
      ? MEMBERSHIP_SYNC_TASK
      : userId
        ? USER_SYNC_TASK
        : organizationId
          ? ORGANIZATION_SYNC_TASK
          : FULL_SYNC_TASK;
  const payload =
    task === FULL_SYNC_TASK
      ? {
          ...origin,
          eventType: "crm.full-sync.requested",
          prune: values.prune,
          apply: values.apply,
        }
      : userId && organizationId
        ? { ...origin, kind: "membership", userId, organizationId }
        : userId
          ? { ...origin, userId }
          : { ...origin, kind: "organization", organizationId };
  const spec =
    task === FULL_SYNC_TASK
      ? fullSyncSpec()
      : organizationId
        ? relatedSyncSpec(organizationId, userId)
        : userSyncSpec(userId ?? "");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  try {
    const result = await pool.query<{ id: string | null }>(
      `SELECT (graphile_worker.add_job($1, $2::json, queue_name := $3, max_attempts := $4, job_key := $5, job_key_mode := $6)).id AS id`,
      [
        task,
        JSON.stringify(payload),
        spec.queueName,
        spec.maxAttempts,
        spec.jobKey,
        spec.jobKeyMode,
      ],
    );
    const jobId = result.rows[0]?.id;
    if (!jobId) throw new Error("CRM command was not admitted.");
    console.info(JSON.stringify({ eventId, jobId, task, admitted: 1, remoteConverged: false }));
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error("CRM sync admission failed; check options, database and configuration.");
  process.exitCode = 1;
});
