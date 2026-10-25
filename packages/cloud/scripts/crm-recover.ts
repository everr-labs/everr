import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { Pool } from "pg";
import { readBrevoConfig } from "../src/crm/brevo/config";
import {
  USER_SYNC_TASK,
  ORGANIZATION_SYNC_TASK,
  MEMBERSHIP_SYNC_TASK,
  relatedSyncSpec,
  userSyncSpec,
} from "../src/crm/commands";

async function main() {
  const { values } = parseArgs({
    options: {
      kind: { type: "string" },
      "source-id": { type: "string" },
      "expected-revision": { type: "string" },
    },
  });
  const config = readBrevoConfig(process.env);
  const revision = Number(values["expected-revision"]);
  if (
    config.mode === "disabled" ||
    !process.env.DATABASE_URL ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !values["source-id"] ||
    !["user", "organization", "membership"].includes(values.kind ?? "")
  )
    throw new Error("Invalid recovery configuration.");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10_000,
  });
  try {
    const row = (
      await pool.query<{
        kind: string;
        source_id: string;
        user_id: string;
        organization_id: string;
      }>(
        "SELECT kind, source_id, user_id, organization_id FROM crm_projection WHERE deployment = $1 AND kind = $2 AND source_id = $3 AND desired_revision = $4 AND retry_failures >= 8 AND synced_revision IS DISTINCT FROM desired_revision",
        [config.deployment, values.kind, values["source-id"], revision],
      )
    ).rows[0];
    if (!row) throw new Error("Recovery precondition failed.");
    const spec =
      row.kind === "user"
        ? userSyncSpec(row.source_id)
        : relatedSyncSpec(row.organization_id, row.kind === "membership" ? row.user_id : undefined);
    const payload = {
      version: 1,
      eventId: randomUUID(),
      eventType: "crm.recovery.requested",
      occurredAt: new Date().toISOString(),
      recoverExhaustedRevision: revision,
      ...(row.kind === "user"
        ? { userId: row.source_id }
        : {
            kind: row.kind,
            organizationId: row.organization_id,
            ...(row.kind === "membership" ? { userId: row.user_id } : {}),
          }),
    };
    const receipt = await pool.query<{ id: string | null }>(
      "SELECT (graphile_worker.add_job($1, $2::json, queue_name := $3, max_attempts := $4, job_key := $5, job_key_mode := $6)).id AS id",
      [
        row.kind === "user"
          ? USER_SYNC_TASK
          : row.kind === "organization"
            ? ORGANIZATION_SYNC_TASK
            : MEMBERSHIP_SYNC_TASK,
        JSON.stringify(payload),
        spec.queueName,
        spec.maxAttempts,
        spec.jobKey,
        spec.jobKeyMode,
      ],
    );
    if (!receipt.rows[0]?.id) throw new Error("Recovery admission failed.");
    console.info(JSON.stringify({ admitted: true, recovered: false, expectedRevision: revision }));
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  console.error(
    "CRM recovery admission failed. Inspect mode, database, identity and expected exhausted revision.",
  );
  process.exitCode = 1;
});
