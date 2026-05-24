// fallow-ignore-file unused-file
import * as z from "zod";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { MOCK_DASHBOARD } from "./mock";

/** @expected-unused — imported by dashboardOptions once the dashboard route is added. */
export const getDashboard = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ dashboardId: z.string() }))
  .handler(async ({ data: { dashboardId: _dashboardId } }) => {
    return MOCK_DASHBOARD;
  });
