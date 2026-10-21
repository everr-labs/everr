import { createOrganizationAdminServerFn } from "#app/lib/serverFn.ts";

export { NotOrganizationAdminError } from "#app/lib/serverFn.ts";

export const ensureOrganizationAdmin = createOrganizationAdminServerFn().handler(async () => ({
  ok: true,
}));
