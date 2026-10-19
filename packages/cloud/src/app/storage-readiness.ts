import { redirect } from "@tanstack/react-router";
import { isOrganizationProvisioned } from "../organization-provisioning/metadata";

export function ensureStorageReady(metadata: unknown, returnTo: string): void {
  if (!isOrganizationProvisioned(metadata))
    throw redirect({
      to: "/organization-pending",
      search: { returnTo },
      replace: true,
    });
}
