import { redirect } from "@tanstack/react-router";
import { isOrganizationProvisioned } from "../organization-provisioning/metadata";

export { assertOrganizationProvisioned as assertStorageReady } from "../organization-provisioning/metadata";

export function ensureStorageReady(metadata: unknown, returnTo: string): void {
  if (!isOrganizationProvisioned(metadata))
    throw redirect({
      to: "/organization-pending",
      search: { returnTo },
      replace: true,
    });
}
export function afterOrganizationSelected(
  createdId: string | null | undefined,
  organizationId: string,
  returnTo: string,
): void {
  if (createdId === organizationId)
    throw redirect({
      to: "/organization-setup",
      search: { returnTo },
      replace: true,
    });
}
