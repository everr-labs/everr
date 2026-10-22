import type {
  Invitation as BetterAuthInvitation,
  Member as BetterAuthMember,
} from "better-auth/plugins/organization";

export type OrgRole = "member" | "admin" | "owner";
export type Member = Pick<BetterAuthMember, "id" | "userId" | "role" | "createdAt"> & {
  user?: { name?: string | null; email?: string | null } | null;
};
export type Invitation = Pick<
  BetterAuthInvitation,
  "id" | "email" | "role" | "status" | "expiresAt"
>;
