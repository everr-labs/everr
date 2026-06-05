import { DEFAULT_TIME_RANGE, resolveTimeRange } from "@everr/ui/lib/time-range";
import { and, eq, sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db/client";
import { dashboardFolders, dashboards } from "@/db/schema";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import type { Dashboard, DashboardSpec } from "./schema";
import {
  createFolderInput,
  dashboardSpecSchema,
  deleteDashboardInput,
  deleteFolderInput,
  moveDashboardInput,
  moveFolderInput,
  renameDashboardInput,
  renameFolderInput,
  saveDashboardInput,
} from "./schema";

export const getDashboard = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ dashboardId: z.string() }))
  .handler(async ({ data: { dashboardId }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    const [row] = await db
      .select({ slug: dashboards.slug, spec: dashboards.spec })
      .from(dashboards)
      .where(
        and(
          eq(dashboards.organizationId, orgId),
          eq(dashboards.slug, dashboardId),
        ),
      )
      .limit(1);

    if (!row) {
      throw new Error(`Dashboard "${dashboardId}" not found`);
    }

    const spec = dashboardSpecSchema.parse(row.spec) as DashboardSpec;

    return {
      kind: "Dashboard",
      metadata: { name: row.slug },
      spec,
    } satisfies Dashboard;
  });

export const saveDashboard = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(saveDashboardInput)
  .handler(async ({ data: { slug, spec, folderId }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    const [existing] = await db
      .select({ id: dashboards.id })
      .from(dashboards)
      .where(
        and(eq(dashboards.organizationId, orgId), eq(dashboards.slug, slug)),
      )
      .limit(1);

    if (existing) {
      await db
        .update(dashboards)
        .set({
          spec: spec as DashboardSpec,
          updatedAt: new Date(),
          ...(folderId !== undefined ? { folderId } : {}),
        })
        .where(eq(dashboards.id, existing.id));
    } else {
      await db.insert(dashboards).values({
        organizationId: orgId,
        slug,
        spec: spec as DashboardSpec,
        folderId: folderId ?? null,
      });
    }

    return { slug };
  });

export const deleteDashboard = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(deleteDashboardInput)
  .handler(async ({ data: { slug }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    await db
      .delete(dashboards)
      .where(
        and(eq(dashboards.organizationId, orgId), eq(dashboards.slug, slug)),
      );

    return { deleted: true };
  });

export const renameDashboard = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(renameDashboardInput)
  .handler(async ({ data: { slug, name }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    const [row] = await db
      .select({ id: dashboards.id, spec: dashboards.spec })
      .from(dashboards)
      .where(
        and(eq(dashboards.organizationId, orgId), eq(dashboards.slug, slug)),
      )
      .limit(1);

    if (!row) {
      throw new Error(`Dashboard "${slug}" not found`);
    }

    await db
      .update(dashboards)
      .set({
        spec: { ...row.spec, display: { ...row.spec.display, name } },
        updatedAt: new Date(),
      })
      .where(eq(dashboards.id, row.id));

    return { slug, name };
  });

export const moveDashboard = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(moveDashboardInput)
  .handler(async ({ data: { slug, folderId }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    if (folderId !== null) {
      const [folder] = await db
        .select({ id: dashboardFolders.id })
        .from(dashboardFolders)
        .where(
          and(
            eq(dashboardFolders.id, folderId),
            eq(dashboardFolders.organizationId, orgId),
          ),
        )
        .limit(1);
      if (!folder) {
        throw new Error("Target folder not found");
      }
    }

    const updated = await db
      .update(dashboards)
      .set({ folderId, updatedAt: new Date() })
      .where(
        and(eq(dashboards.organizationId, orgId), eq(dashboards.slug, slug)),
      )
      .returning({ id: dashboards.id });

    if (updated.length === 0) {
      throw new Error(`Dashboard "${slug}" not found`);
    }

    return { slug };
  });

export const listDashboards = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context }) => {
  const orgId = context.session.session.activeOrganizationId;

  const rows = await db
    .select({
      slug: dashboards.slug,
      folderId: dashboards.folderId,
      displayName: sql<string>`spec->'display'->>'name'`,
    })
    .from(dashboards)
    .where(eq(dashboards.organizationId, orgId));

  return rows.map((r) => ({
    slug: r.slug,
    name: r.displayName ?? r.slug,
    folderId: r.folderId,
  }));
});

export const listFolders = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context }) => {
  const orgId = context.session.session.activeOrganizationId;

  return db
    .select({
      id: dashboardFolders.id,
      parentId: dashboardFolders.parentId,
      name: dashboardFolders.name,
    })
    .from(dashboardFolders)
    .where(eq(dashboardFolders.organizationId, orgId));
});

export const createFolder = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(createFolderInput)
  .handler(async ({ data: { name, parentId }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    const [row] = await db
      .insert(dashboardFolders)
      .values({
        organizationId: orgId,
        parentId: parentId ?? null,
        name,
      })
      .returning({ id: dashboardFolders.id });

    return { id: row?.id };
  });

export const renameFolder = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(renameFolderInput)
  .handler(async ({ data: { folderId, name }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    await db
      .update(dashboardFolders)
      .set({ name, updatedAt: new Date() })
      .where(
        and(
          eq(dashboardFolders.id, folderId),
          eq(dashboardFolders.organizationId, orgId),
        ),
      );

    return { id: folderId };
  });

export const moveFolder = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(moveFolderInput)
  .handler(async ({ data: { folderId, parentId }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    // Cycle check: walk up from the target parent; if we reach the folder
    // being moved, the move would create a cycle.
    const seen = new Set<string>();
    let current = parentId;
    while (current !== null) {
      if (current === folderId) {
        throw new Error(
          "Cannot move a folder into itself or one of its subfolders",
        );
      }
      if (seen.has(current)) break;
      seen.add(current);
      const [row] = await db
        .select({ parentId: dashboardFolders.parentId })
        .from(dashboardFolders)
        .where(
          and(
            eq(dashboardFolders.id, current),
            eq(dashboardFolders.organizationId, orgId),
          ),
        )
        .limit(1);
      if (!row) {
        throw new Error("Target folder not found");
      }
      current = row.parentId;
    }

    await db
      .update(dashboardFolders)
      .set({ parentId, updatedAt: new Date() })
      .where(
        and(
          eq(dashboardFolders.id, folderId),
          eq(dashboardFolders.organizationId, orgId),
        ),
      );

    return { id: folderId };
  });

export const deleteFolder = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(deleteFolderInput)
  .handler(async ({ data: { folderId, mode }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    if (mode === "move-to-root") {
      await db.transaction(async (tx) => {
        await tx
          .update(dashboards)
          .set({ folderId: null })
          .where(
            and(
              eq(dashboards.organizationId, orgId),
              eq(dashboards.folderId, folderId),
            ),
          );

        await tx
          .update(dashboardFolders)
          .set({ parentId: null })
          .where(
            and(
              eq(dashboardFolders.organizationId, orgId),
              eq(dashboardFolders.parentId, folderId),
            ),
          );

        await tx
          .delete(dashboardFolders)
          .where(
            and(
              eq(dashboardFolders.id, folderId),
              eq(dashboardFolders.organizationId, orgId),
            ),
          );
      });
    } else {
      await db
        .delete(dashboardFolders)
        .where(
          and(
            eq(dashboardFolders.id, folderId),
            eq(dashboardFolders.organizationId, orgId),
          ),
        );
    }

    return { deleted: true };
  });

type QueryRow = Record<string, string | number | boolean | null>;

export const runPanelQuery = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      sql: z.string().min(1),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
  )
  .handler(async ({ data: { sql, from, to }, context }) => {
    const { fromISO, toISO } = resolveTimeRange({
      from: from ?? DEFAULT_TIME_RANGE.from,
      to: to ?? DEFAULT_TIME_RANGE.to,
    });
    const rows = await context.clickhouse.query<QueryRow>(sql, {
      from: fromISO,
      to: toISO,
    });
    return { rows };
  });
