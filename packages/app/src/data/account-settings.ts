import { assertAccountDeletionAllowed } from "@app/account";
import { withIdentityRequest } from "@app/request";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { auth } from "@/lib/auth.server";
import { isOrganizationOwner } from "@/lib/organization-role";
import { createPartiallyAuthenticatedServerFn } from "@/lib/serverFn";

const DeleteCurrentUserAccountInputSchema = z.object({
  confirmation: z.literal("DELETE"),
  deleteOrganization: z.boolean().optional(),
});

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

export const deleteCurrentUserAccount = createPartiallyAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(DeleteCurrentUserAccountInputSchema)
  .handler(async ({ data, context: { session } }) => {
    const headers = getRequestHeaders();
    const organizations = (await getFullOrganizations(headers))
      .filter((organization) => organization !== null)
      .map((organization) => {
        const currentMember = organization.members.find(
          (member) => member.userId === session.user.id,
        );
        return {
          organization,
          isOwner: isOrganizationOwner(currentMember?.role),
          ownerCount: organization.members.filter((member) =>
            isOrganizationOwner(member.role),
          ).length,
        };
      });
    await assertAccountDeletionAllowed(
      organizations
        .filter(({ isOwner }) => isOwner)
        .map(({ organization }) => organization),
    );

    const soleOwnedOrganizations = organizations.filter(
      ({ organization, isOwner, ownerCount }) =>
        isOwner &&
        ownerCount === 1 &&
        !(
          data.deleteOrganization &&
          organization.id === session.session.activeOrganizationId
        ),
    );

    if (soleOwnedOrganizations.length > 0) {
      const organizationNames = soleOwnedOrganizations
        .map(({ organization }) => organization.name)
        .filter((name): name is string => Boolean(name))
        .join(", ");
      throw new Error(
        `Transfer ownership before deleting your account. You are the only owner of: ${organizationNames}.`,
      );
    }

    if (data.deleteOrganization) {
      const activeOrganizationId = session.session.activeOrganizationId;
      if (!activeOrganizationId) {
        throw new Error(
          "Select an organization before deleting it with your account.",
        );
      }

      const org = organizations.find(
        ({ organization }) => organization.id === activeOrganizationId,
      );

      if (!org?.isOwner) {
        throw new Error(
          "Only organization owners can delete the organization while deleting their account.",
        );
      }

      await auth.api.deleteOrganization({
        headers,
        body: { organizationId: activeOrganizationId },
      });
    }

    await withIdentityRequest(() =>
      auth.api.deleteUser({
        headers,
        body: {},
      }),
    );
  });
