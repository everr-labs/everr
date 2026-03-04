import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { pollDeviceAuthorization } from "@/lib/cli-device-auth";

const PollBodySchema = z.object({
  device_code: z.string().min(1),
});

export const Route = createFileRoute("/api/cli/auth/device/poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = PollBodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }

        const result = await pollDeviceAuthorization(parsed.data.device_code);
        if (result.status === "ok") {
          return Response.json({
            access_token: result.access_token,
            token_type: result.token_type,
            expires_in: result.expires_in,
          });
        }

        const status =
          result.status === "access_denied" || result.status === "expired_token"
            ? 400
            : 400;
        return Response.json({ error: result.status }, { status });
      },
    },
  },
});
