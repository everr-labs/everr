import { product } from "@composition/product";
import { createServerFn } from "@tanstack/react-start";
import { requireOrgMiddleware } from "#app/lib/serverFn.ts";

export const getActiveOrgPolicy = createServerFn()
  .middleware([requireOrgMiddleware])
  .handler(({ context: { session } }) =>
    product.forOrganization(session.session.activeOrganizationId),
  );
