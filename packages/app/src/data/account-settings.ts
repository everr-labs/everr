import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { auth } from "@/lib/auth.server";
import { createAuthenticatedServerFn } from "@/lib/serverFn";

const DeleteCurrentUserAccountInputSchema = z.object({
  confirmation: z.literal("DELETE"),
  deleteOrganization: z.boolean().optional(),
});

function isOrgOwnerRole(role: string | null | undefined) {
  return (
    role
      ?.split(",")
      .map((part) => part.trim())
      .some((part) => part === "owner") ?? false
  );
}

export const deleteCurrentUserAccount = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(DeleteCurrentUserAccountInputSchema)
  .handler(async ({ data, context: { session } }) => {
    const headers = getRequestHeaders();

    if (data.deleteOrganization) {
      const org = await auth.api.getFullOrganization({
        headers,
        query: { organizationId: session.session.activeOrganizationId },
      });
      const currentMember = org?.members.find((member) => member.userId === session.user.id);

      if (!isOrgOwnerRole(currentMember?.role)) {
        throw new Error(
          "Only organization owners can delete the organization while deleting their account.",
        );
      }

      await auth.api.deleteOrganization({
        headers,
        body: { organizationId: session.session.activeOrganizationId },
      });
    }

    await auth.api.deleteUser({
      headers,
      body: {},
    });
  });
