import { db } from "@/db/client";
import { env } from "@/env";
import { provisionSqlApiOrgUser } from "@/lib/clickhouse";
import { withBillingRequest, withCheckoutLock } from "./lock.server";
import { createBillingModule } from "./module";
import { createPolarGateway } from "./polar.server";
export const billing = createBillingModule({
  db,
  polar: createPolarGateway(),
  lock: (key, run) => withBillingRequest(() => withCheckoutLock(key, run)),
  provisionOrganization: provisionSqlApiOrgUser,
  appUrl: env.BETTER_AUTH_URL,
});
