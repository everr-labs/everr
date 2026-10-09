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

        const currentMember = org.members.find((m) => m.userId === user.id);
        return Response.json({
          name: org.name,
          // Compatibility for installed CLI versions that still gate their
          // cloud setup on organization onboarding. Keep this compatibility flag
          // independent of the web Home onboarding.
          onboardingCompleted: true,
          role: currentMember?.role ?? null,
        });
      },
      PATCH: async () => {
        // Compatibility no-op for old CLI versions. Organization onboarding
        // changes are owned by the authenticated web onboarding function.
        return Response.json({ ok: true });
      },
    },
  },
});
