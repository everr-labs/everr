import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth.server";

export const Route = createFileRoute("/api/cli/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({
          headers: request.headers,
        });

        if (!session?.user) {
          return Response.json({ error: "User not found" }, { status: 404 });
        }

        const name = session.user.name || session.user.email;

        return Response.json({
          email: session.user.email,
          name,
          profileUrl: session.user.image ?? null,
        });
      },
    },
  },
});
