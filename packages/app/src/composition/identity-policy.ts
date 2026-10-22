/**
 * Business policy for identity changes, independent of the authentication provider.
 * Expected denials throw IdentityPolicyError from the public identity/policy-error entry.
 * Operational failures propagate unchanged for the caller to report and retry.
 */
export interface IdentityPolicy {
  beforeUserCreate(
    user: { email: string; emailVerified?: boolean },
    invitationId?: string,
  ): Promise<void>;
  assertAccountDeletionAllowed(
    organizations: Array<{ id: string; name: string }>,
  ): void | Promise<void>;
  beforeUserDelete(userId: string): Promise<void>;
  beforeMembershipChange(
    organizationId: string,
    userId: string,
    nextRole: string | null,
  ): Promise<void>;
  afterMembershipChange(organizationId: string): Promise<void>;
  assertDeletable(organizationId: string): Promise<void>;
}
