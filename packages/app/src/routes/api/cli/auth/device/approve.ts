import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { z } from "zod";
import { ensureTenantForOrganizationId } from "@/data/tenants";
import {
  approveDeviceAuthorization,
  denyDeviceAuthorization,
} from "@/lib/cli-device-auth";

const ApproveBodySchema = z.object({
  user_code: z.string().min(1),
  action: z.enum(["approve", "deny"]).default("approve"),
});

export const Route = createFileRoute("/api/cli/auth/device/approve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await getAuth();
        if (!auth.user) {
          return Response.json({ error: "unauthenticated" }, { status: 401 });
        }

        const parsed = ApproveBodySchema.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json({ error: "invalid_request" }, { status: 400 });
        }

        if (parsed.data.action === "deny") {
          const denied = await denyDeviceAuthorization(parsed.data.user_code);
          if (!denied) {
            return Response.json(
              { error: "invalid_or_expired_code" },
              { status: 400 },
            );
          }
          return Response.json({ ok: true });
        }

        if (!auth.organizationId) {
          return Response.json(
            { error: "missing_organization" },
            { status: 400 },
          );
        }

        const tenantId = await ensureTenantForOrganizationId(
          auth.organizationId,
        );
        const approved = await approveDeviceAuthorization({
          userCode: parsed.data.user_code,
          approvedByUserId: auth.userId,
          approvedForOrganizationId: auth.organizationId,
          approvedForTenantId: tenantId,
        });

        if (!approved) {
          return Response.json(
            { error: "invalid_or_expired_code" },
            { status: 400 },
          );
        }

        return Response.json({ ok: true });
      },
    },
  },
});
