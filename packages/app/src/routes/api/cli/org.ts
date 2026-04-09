import { createFileRoute } from "@tanstack/react-router";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { workOS } from "@/lib/workos";

export const Route = createFileRoute("/api/cli/org")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      GET: async ({ context }) => {
        const { organizationId, userId } = context.session;

        const [org, memberships] = await Promise.all([
          workOS.organizations.getOrganization(organizationId),
          workOS.userManagement.listOrganizationMemberships({
            organizationId,
            limit: 100,
          }),
        ]);

        const isOnlyMember =
          memberships.data.length === 1 &&
          memberships.data[0].userId === userId;

        return Response.json({ name: org.name, isOnlyMember });
      },
    },
  },
});
