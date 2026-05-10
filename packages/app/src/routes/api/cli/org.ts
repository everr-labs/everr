import { createFileRoute } from "@tanstack/react-router";
import { OrgMetadataSchema } from "@/common/org-metadata";
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
        const currentMember = org.members.find((m) => m.userId === user.id);
        const metadata = OrgMetadataSchema.parse(org.metadata);

        return Response.json({
          name: org.name,
          isOnlyMember,
          onboardingCompleted: metadata.onboardingCompleted === true,
          role: currentMember?.role ?? null,
        });
      },
      PATCH: async ({ request, context }) => {
        const { session } = context.session;

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

        const metadata = OrgMetadataSchema.parse(org.metadata);

        await auth.api.updateOrganization({
          headers: request.headers,
          body: {
            organizationId: session.activeOrganizationId,
            data: {
              metadata: { ...metadata, onboardingCompleted: true },
            },
          },
        });

        return Response.json({ ok: true });
      },
    },
  },
});
