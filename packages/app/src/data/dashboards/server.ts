import { and, eq, sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db/client";
import { dashboardFolders, dashboards } from "@/db/schema";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { DEFAULT_TIME_RANGE, resolveTimeRange } from "@/lib/time-range";
import {
  createFolderInput,
  dashboardSpecSchema,
  deleteDashboardInput,
  deleteFolderInput,
  renameFolderInput,
  saveDashboardInput,
} from "./schema";
import type { Dashboard, DashboardSpec } from "./types";

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
          folderId: folderId ?? null,
          updatedAt: new Date(),
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

export const listDashboards = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context }) => {
  const orgId = context.session.session.activeOrganizationId;

  const rows = await db
    .select({
      slug: dashboards.slug,
      displayName: sql<string>`spec->'display'->>'name'`,
    })
    .from(dashboards)
    .where(eq(dashboards.organizationId, orgId));

  return rows.map((r) => ({
    slug: r.slug,
    name: r.displayName ?? r.slug,
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

    return { id: row!.id };
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
