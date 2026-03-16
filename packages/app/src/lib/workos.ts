import { WorkOS } from "@workos-inc/node";
import { env } from "@/env";

export const workOS = new WorkOS({
  apiKey: env.WORKOS_API_KEY,
  clientId: env.WORKOS_CLIENT_ID,
});
