import { billing } from "../billing/server";
import { readOrgEntitlement } from "../billing-data.server";
import { createCloudIdentityPolicy } from "./identity-policy";

export const identityPolicy = createCloudIdentityPolicy({
  billing,
  readOrgEntitlement,
});
