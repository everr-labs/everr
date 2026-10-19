/** Business policy for identity changes, independent of the authentication provider. */
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
