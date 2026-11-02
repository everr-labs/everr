import { events } from "@everr/app/server/events/runtime";
import { db } from "@everr/app/db/client";
import { env } from "@everr/app/env";
import { withBillingRequest, withCheckoutLock } from "./lock.server";
import { createBillingModule } from "./module";
import { createPolarGateway } from "./polar.server";
export const billing = createBillingModule({
  db,
  events,
  polar: createPolarGateway(),
  lock: (key, run) => withBillingRequest(() => withCheckoutLock(key, run)),
  appUrl: env.BETTER_AUTH_URL,
});
