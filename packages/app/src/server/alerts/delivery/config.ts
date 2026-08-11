import { and, eq, lt, or, type SQL } from "drizzle-orm";
import { alertDeliveries } from "@/db/schema";

export const ALERT_DELIVERY_MAX_ATTEMPTS = 5;

/**
 * A delivery that still has a send to make: it holds its channel's config
 * open, and retention must leave it alone. The complement is terminal, which
 * `alert_deliveries_terminal_cleanup_idx` and the retention sweep key on.
 */
export const deliveryIsInFlight: SQL = or(
  eq(alertDeliveries.status, "pending"),
  and(
    eq(alertDeliveries.status, "failed"),
    lt(alertDeliveries.attempts, ALERT_DELIVERY_MAX_ATTEMPTS),
  ),
) as SQL;
