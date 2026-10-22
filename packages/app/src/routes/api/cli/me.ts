import { deployment } from "@composition/deployment";

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/cli/me")({
  server: {
    handlers: {
      GET: ({ context: { session, organization } }) => {
        return Response.json({
          userId: session.user.id,
          organizationId: organization.id,
          email: session.user.email,
          name: session.user.name || session.user.email,
          organizationName: organization.name,
          ingestEndpoint: deployment.ingestEndpoint ?? null,
        });
      },
    },
  },
});
