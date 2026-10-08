import { SpanStatusCode, trace } from "@opentelemetry/api";
import { eq } from "drizzle-orm";
import { isOrganizationProvisioned } from "@/common/organization-provisioning";
import { type Database, db } from "@/db/client";
import { organization } from "@/db/schema";
import {
  mergeTelemetryIdentity,
  withTelemetryIdentityScope,
} from "@/telemetry/identity";
import { exceptionAttributes, serverLogger } from "@/telemetry/logger";

const SIGNUP_WAIT_MS = 5000;
const POLL_INTERVAL_MS = 100;
const tracer = trace.getTracer("everr-app.organization-provisioning");

// The organization and fallback job are already committed when this runs.
// Wait for the dedicated worker so signup can return ready without introducing
// a second provisioning path that races queued provisioning or deletion.
export function waitForOrganizationProvisioning(
  organizationId: string,
  database: Database = db,
): Promise<boolean> {
  return withTelemetryIdentityScope(() => {
    mergeTelemetryIdentity({ organizationId });
    return tracer.startActiveSpan(
      "clickhouse.organization.fast_path",
      async (span) => {
        let stopped = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const ready = async () => {
          while (!stopped) {
            const [org] = await database
              .select({ metadata: organization.metadata })
              .from(organization)
              .where(eq(organization.id, organizationId));
            if (stopped || !org) return false;
            if (isOrganizationProvisioned(org.metadata)) return true;
            await new Promise<void>((resolve) =>
              setTimeout(resolve, POLL_INTERVAL_MS),
            );
          }
          return false;
        };
        try {
          // The deadline also bounds waiting for a slow/exhausted Postgres
          // connection. A late read cannot restart the polling loop.
          const result = await Promise.race([
            ready(),
            new Promise<boolean>((resolve) => {
              timeout = setTimeout(() => resolve(false), SIGNUP_WAIT_MS);
            }),
          ]);
          const outcome = result ? "ready" : "pending";
          span.setAttribute("everr.provisioning.fast_path.outcome", outcome);
          serverLogger.info(`clickhouse.organization.fast_path.${outcome}`, {
            "everr.organization.id": organizationId,
          });
          return result;
        } catch (error) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });
          span.setAttribute("everr.provisioning.fast_path.outcome", "error");
          serverLogger.error("clickhouse.organization.fast_path.failed", {
            ...exceptionAttributes(error),
            "everr.organization.id": organizationId,
          });
          // Readiness observation is optional; the committed job still runs.
          return false;
        } finally {
          stopped = true;
          clearTimeout(timeout);
          span.end();
        }
      },
    );
  });
}
