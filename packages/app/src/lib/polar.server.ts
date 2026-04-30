import { Polar } from "@polar-sh/sdk";
import { ResourceNotFound } from "@polar-sh/sdk/models/errors/resourcenotfound";
import { env } from "@/env";

export const polarClient = new Polar({
  accessToken: env.POLAR_ACCESS_TOKEN,
  server: env.POLAR_SERVER,
});

export async function ensurePolarCustomerForOrg(args: {
  orgId: string;
  orgName: string;
  fallbackEmail: string;
}) {
  try {
    return await polarClient.customers.getExternal({ externalId: args.orgId });
  } catch (err) {
    if (!(err instanceof ResourceNotFound)) throw err;
    return await polarClient.customers.create({
      externalId: args.orgId,
      email: args.fallbackEmail,
      name: args.orgName,
    });
  }
}
