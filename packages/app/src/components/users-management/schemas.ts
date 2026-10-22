import { z } from "zod";

export const OrgRoleSchema = z.enum(["member", "admin", "owner"]);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

// Better Auth stores memberships and invitations with comma-separated roles.
// Picker inputs remain single roles, while responses preserve every role.
const OrgRoleListSchema = z
  .string()
  .refine(
    (role) => role.split(",").every((part) => OrgRoleSchema.safeParse(part.trim()).success),
    "Invalid organization roles",
  );

// Better Auth responses can contain Date objects or their JSON representation.
const AuthDateSchema = z.union([z.date(), z.iso.datetime({ offset: true })]).pipe(z.coerce.date());
const IdSchema = z.string().min(1);

const MemberSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  role: OrgRoleListSchema,
  createdAt: AuthDateSchema,
  user: z.object({ name: z.string().nullish(), email: z.string().nullish() }).nullish(),
});
export type Member = z.infer<typeof MemberSchema>;

export const InvitationSchema = z.object({
  id: IdSchema,
  email: z.email(),
  role: OrgRoleListSchema,
  status: z.enum(["pending", "accepted", "rejected", "canceled"]),
  expiresAt: AuthDateSchema,
});
export type Invitation = z.infer<typeof InvitationSchema>;

// Accept both response envelopes supported by our auth client, then expose only
// validated arrays to the query cache and table components.
const MembersSchema = z.array(MemberSchema);
export const MembersResponseSchema = z.union([
  MembersSchema,
  z.object({ members: MembersSchema }).transform(({ members }) => members),
]);

const InvitationsSchema = z.array(InvitationSchema);
export const InvitationsResponseSchema = z.union([
  InvitationsSchema,
  z.object({ invitations: InvitationsSchema }).transform(({ invitations }) => invitations),
]);

export const InviteMemberInputSchema = z.object({
  email: z.email(),
  role: OrgRoleSchema,
  sendEmail: z.boolean(),
});
export type InviteMemberInput = z.infer<typeof InviteMemberInputSchema>;

export const UpdateMemberRoleInputSchema = z.object({
  memberId: MemberSchema.shape.id,
  role: OrgRoleSchema,
});
export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleInputSchema>;
