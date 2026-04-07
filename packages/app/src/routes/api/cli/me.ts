import { createFileRoute } from "@tanstack/react-router";
import { accessTokenAuthMiddleware } from "@/lib/accessTokenAuthMiddleware";
import { workOS } from "@/lib/workos";

export const Route = createFileRoute("/api/cli/me")({
  server: {
    middleware: [accessTokenAuthMiddleware],
    handlers: {
      GET: async ({ context }) => {
        const user = await workOS.userManagement.getUser(
          context.session.userId,
        );

        const nameParts = [user.firstName, user.lastName].filter(Boolean);
        const name = nameParts.length > 0 ? nameParts.join(" ") : user.email;

        return Response.json({
          email: user.email,
          name,
          profileUrl: user.profilePictureUrl ?? null,
        });
      },
    },
  },
});
