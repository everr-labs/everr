import { redirect } from "@tanstack/react-router";
import { getActiveOrgPolicy } from "@everr/app/data/product";

export async function getAppAccess() {
  const policy = await getActiveOrgPolicy();
  if (policy.access === "suspended") {
    throw redirect({ to: "/billing/suspended", replace: true });
  }
  return policy;
}
