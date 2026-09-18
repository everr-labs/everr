import { createOrganizationAdminServerFn } from "@/lib/serverFn";

export { NotOrganizationAdminError } from "@/lib/serverFn";

export const ensureOrganizationAdmin =
  createOrganizationAdminServerFn().handler(async () => ({ ok: true }));
