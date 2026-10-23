import { metrics } from "@opentelemetry/api";
import { serverLogger } from "@everr/app/telemetry/logger";

type Stage =
  | "validation"
  | "envelope"
  | "storage"
  | "publication"
  | "overload"
  | "closed"
  | "drain";
export interface MilestoneDiagnostics {
  log(stage: Stage): void | Promise<void>;
  count(stage: Stage): void | Promise<void>;
}
const failures = metrics
  .getMeter("everr-cloud.organization-milestones")
  .createCounter("everr.organization_milestones.failures", {
    unit: "1",
    description: "Best-effort useful consultation observation failures and drops",
  });

/** Raw evidence, auth material, query text, customer payloads and exceptions never enter diagnostics. */
export const milestoneDiagnostic: MilestoneDiagnostics = {
  log(stage) {
    serverLogger.error("organization.milestones.failed", {
      "everr.milestone.failure_stage": stage,
    });
  },
  count(stage) {
    failures.add(1, { "everr.milestone.failure_stage": stage });
  },
};
