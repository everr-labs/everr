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

        const adminMembers = memberships.data.filter(
          (m) => m.role?.slug === "admin",
        );
        const isOnlyAdmin =
          adminMembers.length === 1 && adminMembers[0].userId === userId;

        return Response.json({ name: org.name, isOnlyAdmin });
      },
    },
  },
});
