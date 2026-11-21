import { product } from "@composition/product";
import { createServerFn } from "@tanstack/react-start";
import { requireOrgAllowingSuspendedMiddleware } from "#app/lib/serverFn.ts";

export const getActiveOrgPolicy = createServerFn()
  // The app reads this to learn the organization is suspended.
  .middleware([requireOrgAllowingSuspendedMiddleware])
  .handler(({ context: { session } }) =>
    product.forOrganization(session.session.activeOrganizationId),
  );
