import type { IdentityPolicy } from "./identity-policy";
import type { IdentityProvider } from "./identity-provider";

/** Policy and provider integration are selected together at authentication startup. */
export interface ApplicationIdentity {
  policy: IdentityPolicy;
  provider: IdentityProvider;
}
