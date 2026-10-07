import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { addWorkerJob } from "@/server/worker/jobs";

export const SQL_API_PROVISION_TASK = "sql-api/provision-org-user";

// Graphile spaces retries by exp(least(attempts, 10)) seconds. Eight attempts
// cover a multi-minute ClickHouse stall (the 7 Oct 2026 signup landed in an
// eight-minute outage) and then stop instead of retrying for hours.
const SQL_API_PROVISION_MAX_ATTEMPTS = 8;

// Healthy provisioning is a handful of milliseconds. The shared admin client
// waits 30s, which is what held the Google callback open during the stall.
export const SQL_API_SIGNUP_PROVISION_TIMEOUT_MS = 5_000;

export type SqlApiOrgUserSetup = "ready" | "pending" | "failed";

const SETUP_PENDING_MESSAGE =
  "We're still finishing setting up your account. Try again in a minute.";
const SETUP_FAILED_MESSAGE = "We couldn't finish setting up your account.";

// Thrown by SQL API reads while the per-org ClickHouse user is not ready, so
// callers skip ClickHouse instead of hanging on a stall or reporting a missing
// user as a bad password. Classified by name, same as SqlApiGuardError.
class SqlApiOrgSetupPendingError extends Error {
  readonly setupStatus: Exclude<SqlApiOrgUserSetup, "ready">;

  constructor(setupStatus: Exclude<SqlApiOrgUserSetup, "ready">) {
    super(
      setupStatus === "failed" ? SETUP_FAILED_MESSAGE : SETUP_PENDING_MESSAGE,
    );
    this.name = "SqlApiOrgSetupPendingError";
    this.setupStatus = setupStatus;
  }
}

// A ready organization has no job row, and the row is deleted when the job
// succeeds. Remember that so panel queries do not hit Postgres on every read.
const readyOrganizationIds = new Set<string>();

function sqlApiProvisionJobKey(organizationId: string): string {
  return `${SQL_API_PROVISION_TASK}:${organizationId}`;
}

export function markSqlApiOrgUserReady(organizationId: string): void {
  readyOrganizationIds.add(organizationId);
}

function forgetSqlApiOrgUserReady(organizationId: string): void {
  readyOrganizationIds.delete(organizationId);
}

type ProvisionJobRow = {
  attempts: number | string;
  max_attempts: number | string;
  locked_at: Date | string | null;
};

function setupFromJob(row: ProvisionJobRow | undefined): SqlApiOrgUserSetup {
  if (!row) return "ready";
  // The last attempt increments `attempts` up to `max_attempts` while the job
  // is still running. A lock means it has not given up yet.
  if (row.locked_at !== null) return "pending";
  if (Number(row.attempts) >= Number(row.max_attempts)) return "failed";
  return "pending";
}

export async function readSqlApiOrgUserSetup(
  organizationId: string,
): Promise<SqlApiOrgUserSetup> {
  if (readyOrganizationIds.has(organizationId)) return "ready";

  const jobs = await db.execute<ProvisionJobRow>(sql`
    SELECT attempts, max_attempts, locked_at
    FROM graphile_worker.jobs
    WHERE task_identifier = ${SQL_API_PROVISION_TASK}
      AND key = ${sqlApiProvisionJobKey(organizationId)}
    LIMIT 1
  `);
  const status = setupFromJob(jobs.rows[0]);
  if (status === "ready") readyOrganizationIds.add(organizationId);
  return status;
}

export async function assertSqlApiOrgUserReady(
  organizationId: string,
): Promise<void> {
  const status = await readSqlApiOrgUserSetup(organizationId);
  if (status !== "ready") throw new SqlApiOrgSetupPendingError(status);
}

// `unsafe_dedupe` leaves a job that is already queued or permanently failed
// alone. A second signup hook must not reset the retry clock.
export async function enqueueSqlApiOrgUserProvision(
  organizationId: string,
): Promise<void> {
  forgetSqlApiOrgUserReady(organizationId);
  await addWorkerJob(
    SQL_API_PROVISION_TASK,
    { organizationId },
    {
      jobKey: sqlApiProvisionJobKey(organizationId),
      jobKeyMode: "unsafe_dedupe",
      maxAttempts: SQL_API_PROVISION_MAX_ATTEMPTS,
    },
  );
}

// Manual retry. `replace` resets attempts on the existing job.
export async function retrySqlApiOrgUserProvision(
  organizationId: string,
): Promise<void> {
  forgetSqlApiOrgUserReady(organizationId);
  await addWorkerJob(
    SQL_API_PROVISION_TASK,
    { organizationId },
    {
      jobKey: sqlApiProvisionJobKey(organizationId),
      jobKeyMode: "replace",
      maxAttempts: SQL_API_PROVISION_MAX_ATTEMPTS,
    },
  );
}

export async function cancelSqlApiOrgUserProvision(
  organizationId: string,
): Promise<void> {
  forgetSqlApiOrgUserReady(organizationId);
  await db.execute(sql`
    SELECT graphile_worker.remove_job(${sqlApiProvisionJobKey(organizationId)})
  `);
}
