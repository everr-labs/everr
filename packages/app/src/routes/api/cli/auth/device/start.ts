import { createFileRoute } from "@tanstack/react-router";
import { startDeviceAuthorization } from "@/lib/cli-device-auth";

export const Route = createFileRoute("/api/cli/auth/device/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const payload = await startDeviceAuthorization(url.origin);
        return Response.json(payload);
      },
    },
  },
});
