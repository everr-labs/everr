import { and, eq, gt, isNull, lte, type SQL, sql } from "drizzle-orm";
import { alertSilences } from "@/db/schema";

// The single definition of an active silence: started, not yet ended, and not
// cancelled. Used by both notification delivery and the alerts UI so the two
// can never disagree about whether an instance is silenced.
export function activeSilenceConditions(
  organizationId: string,
  alertDefinitionId: string,
  now: Date | SQL = sql`now()`,
) {
  return and(
    eq(alertSilences.organizationId, organizationId),
    eq(alertSilences.alertDefinitionId, alertDefinitionId),
    lte(alertSilences.startsAt, now),
    gt(alertSilences.endsAt, now),
    isNull(alertSilences.cancelledAt),
  );
}
