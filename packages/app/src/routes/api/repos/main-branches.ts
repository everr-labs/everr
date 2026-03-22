// GET /api/repos/main-branches?repo=everr-labs/everr
// PUT /api/repos/main-branches?repo=everr-labs/everr  body: { branches: string[] }

import { createFileRoute } from "@tanstack/react-router";
import { getAuth } from "@workos/authkit-tanstack-react-start";
import { z } from "zod";
import { getMainBranches, setRepoMainBranches } from "@/data/main-branches";
import { getTenantForOrganizationId } from "@/data/tenants";

const branchesBody = z.object({
  branches: z.array(z.string().trim().min(1)).min(1),
});

export const Route = createFileRoute("/api/repos/main-branches")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await getAuth();
        if (!auth.user) {
          return Response.json({ error: "unauthenticated" }, { status: 401 });
        }
        if (!auth.organizationId) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }
        const repo = new URL(request.url).searchParams.get("repo");
        if (!repo)
          return Response.json({ error: "missing repo" }, { status: 400 });

        const tenantId = await getTenantForOrganizationId(auth.organizationId);
        if (tenantId == null) {
          console.error(
            `No tenant for authenticated org ${auth.organizationId}`,
          );
          return Response.json({ error: "internal error" }, { status: 500 });
        }

        const branches = await getMainBranches(tenantId, repo);
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
        const repo = new URL(request.url).searchParams.get("repo");
        if (!repo)
          return Response.json({ error: "missing repo" }, { status: 400 });

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

        await setRepoMainBranches(tenantId, repo, parsed.data.branches);
        return Response.json({ ok: true });
      },
    },
  },
});
