// GET /api/repos/main-branches?repo=everr-labs/everr
// PUT /api/repos/main-branches?repo=everr-labs/everr  body: { branches: string[] }

import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { z } from "zod";
import { getMainBranches, setRepoMainBranches } from "@/data/main-branches";
import { getTenantForOrganizationId } from "@/data/tenants";

export const Route = createFileRoute("/api/repos/main-branches")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getAuth();
        if (!auth.user || !auth.organizationId) {
          return Response.json({ error: "unauthenticated" }, { status: 401 });
        }
        const repo = new URL(request.url).searchParams.get("repo");
        if (!repo)
          return Response.json({ error: "missing repo" }, { status: 400 });

        const tenantId = await getTenantForOrganizationId(auth.organizationId);
        if (tenantId == null)
          return Response.json({ error: "tenant not found" }, { status: 404 });

        const branches = await getMainBranches(tenantId, repo);
        return Response.json({ branches });
      },
      PUT: async ({ request }) => {
        const auth = await getAuth();
        if (!auth.user || !auth.organizationId) {
          return Response.json({ error: "unauthenticated" }, { status: 401 });
        }
        const repo = new URL(request.url).searchParams.get("repo");
        if (!repo)
          return Response.json({ error: "missing repo" }, { status: 400 });

        const branchesBody = z.object({
          branches: z.array(z.string().min(1)).min(1),
        });
        const parsed = branchesBody.safeParse(await request.json());
        if (!parsed.success) {
          return Response.json(
            { error: "branches must be a non-empty array of strings" },
            { status: 422 },
          );
        }

        const tenantId = await getTenantForOrganizationId(auth.organizationId);
        if (tenantId == null)
          return Response.json({ error: "tenant not found" }, { status: 404 });

        await setRepoMainBranches(tenantId, repo, parsed.data.branches);
        return Response.json({ ok: true });
      },
    },
  },
});
