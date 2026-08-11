import { z } from "zod";

export const ALERT_PROJECT_LIFECYCLE_TASK = "alerts/project-lifecycle";

/**
 * Enqueued by pause and delete in the mutation's own transaction, so the
 * projection of the journal rows it wrote runs exactly when the mutation
 * committed. `closedEventIds` are `instance_closed` journal rows;
 * `suppressedEventIds` are the notifying journal rows the mutation canceled,
 * each of which gets a terminal `notification_suppressed` projection.
 */
export const AlertLifecycleProjectionPayloadSchema = z.object({
  closedEventIds: z.array(z.string().uuid()),
  suppressedEventIds: z.array(z.string().uuid()),
  reason: z.enum(["labels_changed", "rule_paused", "rule_deleted"]),
});
