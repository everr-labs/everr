import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth.server";

export const Route = createFileRoute("/api/cli/org")({
  server: {
    handlers: {
      GET: async ({ request, context }) => {
        const { session, user } = context.session;

        const org = await auth.api.getFullOrganization({
          headers: request.headers,
          query: { organizationId: session.activeOrganizationId },
        });

        if (!org) {
          return Response.json(
            { error: "Organization not found" },
            { status: 404 },
          );
        }

        const isOnlyMember =
          org.members.length === 1 && org.members[0].userId === user.id;

        return Response.json({ name: org.name, isOnlyMember });
      },
    },
  },
});
