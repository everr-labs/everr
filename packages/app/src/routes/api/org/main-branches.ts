// GET /api/org/main-branches
// PUT /api/org/main-branches  body: { branches: string[] }

import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { z } from "zod";
import { getOrgMainBranches, setOrgMainBranches } from "@/data/main-branches";
import { getTenantForOrganizationId } from "@/data/tenants";

const branchesBody = z.object({
  branches: z.array(z.string().trim().min(1)).min(1),
});

export const Route = createFileRoute("/api/org/main-branches")({
  server: {
    handlers: {
      GET: async () => {
        const auth = await getAuth();
        if (!auth.user) {
          return Response.json({ error: "unauthenticated" }, { status: 401 });
        }
        if (!auth.organizationId) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }

        const tenantId = await getTenantForOrganizationId(auth.organizationId);
        if (tenantId == null) {
          console.error(
            `No tenant for authenticated org ${auth.organizationId}`,
          );
          return Response.json({ error: "internal error" }, { status: 500 });
        }

        const branches = await getOrgMainBranches(tenantId);
        return Response.json({ branches });
      },
      PUT: async ({ request }) => {
        const auth = await getAuth();
        if (!auth.user) {
          return Response.json({ error: "unauthenticated" }, { status: 401 });
        }
        if (!auth.organizationId) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }

        const parsed = branchesBody.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json(
            { error: "branches must be a non-empty array of strings" },
            { status: 422 },
          );
        }

        const tenantId = await getTenantForOrganizationId(auth.organizationId);
        if (tenantId == null) {
          console.error(
            `No tenant for authenticated org ${auth.organizationId}`,
          );
          return Response.json({ error: "internal error" }, { status: 500 });
        }

        await setOrgMainBranches(tenantId, parsed.data.branches);
        return Response.json({ ok: true });
      },
    },
  },
});
