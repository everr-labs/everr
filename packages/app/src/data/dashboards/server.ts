import * as z from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { DEFAULT_TIME_RANGE, resolveTimeRange } from "@/lib/time-range";
import { MOCK_DASHBOARD } from "./mock";

export const getDashboard = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ dashboardId: z.string() }))
  .handler(async ({ data: { dashboardId: _dashboardId } }) => {
    return MOCK_DASHBOARD;
  });

type QueryRow = Record<string, string | number | boolean | null>;

export const runPanelQuery = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      sql: z.string().min(1),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
  )
  .handler(async ({ data: { sql, from, to }, context }) => {
    const { fromISO, toISO } = resolveTimeRange({
      from: from ?? DEFAULT_TIME_RANGE.from,
      to: to ?? DEFAULT_TIME_RANGE.to,
    });
    const rows = await context.clickhouse.query<QueryRow>(sql, {
      from: fromISO,
      to: toISO,
    });
    return { rows };
  });
