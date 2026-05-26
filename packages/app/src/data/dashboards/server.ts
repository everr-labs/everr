import * as z from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
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
  .inputValidator(z.object({ sql: z.string().min(1) }))
  .handler(async ({ data: { sql }, context }) => {
    const rows = await context.clickhouse.query<QueryRow>(sql);
    return { rows };
  });
