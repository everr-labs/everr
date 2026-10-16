import { productPolicy } from "@app/policy";
import { createServerFn } from "@tanstack/react-start";
import { requireOrgMiddleware } from "@/lib/serverFn";

export const getActiveOrgPolicy = createServerFn()
  .middleware([requireOrgMiddleware])
  .handler(({ context: { session } }) =>
    productPolicy.forOrganization(session.session.activeOrganizationId),
  );
