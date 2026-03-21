// GET /api/org/main-branches
// PUT /api/org/main-branches  body: { branches: string[] }

import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { z } from "zod";
import { getOrgMainBranches, setOrgMainBranches } from "@/data/main-branches";
import { getTenantForOrganizationId } from "@/data/tenants";

export const Route = createFileRoute("/api/org/main-branches")({
  server: {
    handlers: {
      GET: async ({ request: _request }) => {
        const auth = await getAuth();
        if (!auth.user || !auth.organizationId) {
          return Response.json({ error: "unauthenticated" }, { status: 401 });
        }

        const tenantId = await getTenantForOrganizationId(auth.organizationId);
        if (tenantId == null)
          return Response.json({ error: "tenant not found" }, { status: 404 });

        const branches = await getOrgMainBranches(tenantId);
        return Response.json({ branches });
      },
      PUT: async ({ request }) => {
        const auth = await getAuth();
        if (!auth.user || !auth.organizationId) {
          return Response.json({ error: "unauthenticated" }, { status: 401 });
        }

        const parsed = z
          .object({ branches: z.array(z.string().min(1)).min(1) })
          .safeParse(await request.json());
        if (!parsed.success) {
          return Response.json(
            { error: "branches must be a non-empty array of strings" },
            { status: 422 },
          );
        }

        const tenantId = await getTenantForOrganizationId(auth.organizationId);
        if (tenantId == null)
          return Response.json({ error: "tenant not found" }, { status: 404 });

        await setOrgMainBranches(tenantId, parsed.data.branches);
        return Response.json({ ok: true });
      },
    },
  },
});
