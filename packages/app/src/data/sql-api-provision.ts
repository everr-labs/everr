import { createAuthenticatedServerFn } from "@/lib/serverFn";
import {
  readSqlApiOrgUserSetup,
  retrySqlApiOrgUserProvision,
} from "@/server/sql-api-provision/status";

export const getSqlApiOrgUserSetup = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context }) => ({
  status: await readSqlApiOrgUserSetup(
    context.session.session.activeOrganizationId,
  ),
}));

export const retrySqlApiOrgUserSetup = createAuthenticatedServerFn({
  method: "POST",
}).handler(async ({ context }) => {
  await retrySqlApiOrgUserProvision(
    context.session.session.activeOrganizationId,
  );
  return { status: "pending" as const };
});
