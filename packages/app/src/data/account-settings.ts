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

async function getFullOrganizations(headers: Headers) {
  const organizations = await auth.api.listOrganizations({ headers });

  return Promise.all(
    organizations.map((organization) =>
      auth.api.getFullOrganization({
        headers,
        query: { organizationId: organization.id },
      }),
    ),
  );
}

export const deleteCurrentUserAccount = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(DeleteCurrentUserAccountInputSchema)
  .handler(async ({ data, context: { session } }) => {
    const headers = getRequestHeaders();
    const organizations = await getFullOrganizations(headers);
    const soleOwnedOrganizations = organizations.filter((organization) => {
      if (!organization) return false;
      if (
        data.deleteOrganization &&
        organization.id === session.session.activeOrganizationId
      ) {
        return false;
      }

      const currentMember = organization.members.find(
        (member) => member.userId === session.user.id,
      );
      const ownerCount = organization.members.filter((member) =>
        isOrgOwnerRole(member.role),
      ).length;

      return isOrgOwnerRole(currentMember?.role) && ownerCount === 1;
    });

    if (soleOwnedOrganizations.length > 0) {
      const organizationNames = soleOwnedOrganizations
        .map((organization) => organization?.name)
        .filter((name): name is string => Boolean(name))
        .join(", ");
      throw new Error(
        `Transfer ownership before deleting your account. You are the only owner of: ${organizationNames}.`,
      );
    }

    if (data.deleteOrganization) {
      const org = organizations.find(
        (organization) =>
          organization?.id === session.session.activeOrganizationId,
      );
      const currentMember = org?.members.find(
        (member) => member.userId === session.user.id,
      );

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
