import { notFound } from "@tanstack/react-router";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as z from "zod";
import { overlayPreview, type PreviewStatus } from "@/data/previews/overlay";
import { getCoveredRepoids } from "@/data/previews/repoids";
import {
  effectiveRepoid,
  liveOrPreview,
  previewJoin,
} from "@/data/previews/scope";
import { db } from "@/db/client";
import { dashboards, previews } from "@/db/schema";
import { querySqlApi } from "@/lib/clickhouse";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import type { Dashboard } from "./schema";
import { dashboardSpecSchema } from "./schema";

export const getDashboard = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      project: z.string(),
      slug: z.string(),
      preview: z.string().optional(),
    }),
  )
  .handler(async ({ data: { project, slug, ...rest }, context }) => {
    const orgId = context.session.session.activeOrganizationId;
    const preview = rest.preview ?? null;

    const identity = and(
      eq(dashboards.organizationId, orgId),
      eq(dashboards.project, project),
      eq(dashboards.slug, slug),
    );

    if (preview === null) {
      const [row] = await db
        .select({ document: dashboards.document })
        .from(dashboards)
        .where(and(identity, isNull(dashboards.previewId)))
        .limit(1);
      if (!row) throw notFound();
      dashboardSpecSchema.parse(row.document.spec);
      // Typed binding (not an assertion) so the live and preview branches share
      // one return shape without widening `undefined` via a cast.
      const previewStatus: PreviewStatus | undefined = undefined;
      return { document: row.document satisfies Dashboard, previewStatus };
    }

    // Live rows (previewId NULL) plus this preview's rows; `previewId` is the
    // overlay's live/preview discriminator.
    const [covered, rows] = await Promise.all([
      getCoveredRepoids(orgId, preview),
      db
        .select({
          repoid: effectiveRepoid(dashboards),
          previewId: dashboards.previewId,
          project: dashboards.project,
          slug: dashboards.slug,
          folderPath: dashboards.folderPath,
          document: dashboards.document,
        })
        .from(dashboards)
        .leftJoin(previews, previewJoin(dashboards))
        .where(and(identity, liveOrPreview(dashboards, preview))),
    ]);
    const overlaid = overlayPreview({ rows, coveredRepoids: covered });
    // Prefer a surviving row; a shadowed-by-deletion live row still renders,
    // marked "removed", instead of 404ing mid-review.
    const row =
      overlaid.find((r) => r.previewStatus !== "removed") ??
      overlaid.find((r) => r.previewStatus === "removed");
    if (!row) throw notFound();
    dashboardSpecSchema.parse(row.document.spec);
    return {
      document: row.document satisfies Dashboard,
      previewStatus: row.previewStatus,
    };
  });

export const listDashboards = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ preview: z.string().optional() }).optional())
  .handler(async ({ data, context }) => {
    const orgId = context.session.session.activeOrganizationId;
    const preview = data?.preview ?? null;

    // Live path never diffs against anything, so it only needs the scalar
    // columns `toItem` returns — no `document` (expensive JSONB) fetch. The
    // preview path feeds `overlayPreview`, which diffs `document` and keys off
    // `repoid`/`previewId`, so it keeps those.
    const liveSelect = {
      slug: dashboards.slug,
      project: dashboards.project,
      folderPath: dashboards.folderPath,
      displayName: sql<string>`document->'spec'->'display'->>'name'`,
    };

    const previewSelect = {
      repoid: effectiveRepoid(dashboards),
      previewId: dashboards.previewId,
      slug: dashboards.slug,
      project: dashboards.project,
      folderPath: dashboards.folderPath,
      document: dashboards.document,
      displayName: sql<string>`document->'spec'->'display'->>'name'`,
    };

    const toItem = (row: {
      slug: string;
      project: string;
      folderPath: string;
      displayName: string | null;
      previewStatus?: PreviewStatus;
    }) => ({
      slug: row.slug,
      project: row.project,
      name: row.displayName ?? row.slug,
      folderPath: row.folderPath,
      previewStatus: row.previewStatus,
    });

    if (preview === null) {
      const rows = await db
        .select(liveSelect)
        .from(dashboards)
        .where(
          and(
            eq(dashboards.organizationId, orgId),
            isNull(dashboards.previewId),
          ),
        );
      return rows.map(toItem);
    }

    const [covered, rows] = await Promise.all([
      getCoveredRepoids(orgId, preview),
      db
        .select(previewSelect)
        .from(dashboards)
        .leftJoin(previews, previewJoin(dashboards))
        .where(
          and(
            eq(dashboards.organizationId, orgId),
            liveOrPreview(dashboards, preview),
          ),
        ),
    ]);
    return overlayPreview({ rows, coveredRepoids: covered }).map(toItem);
  });

type QueryRow = Record<string, string | number | boolean | null>;

/**
 * The cloud half of the panel `SqlClient` seam: run already-built panel SQL and
 * hand back rows. Interpolation, the `{from}`/`{to}`/`{step}` binding and the
 * options row cap all live in PanelRepository now, so the cloud and local
 * backends cannot drift apart.
 *
 * The SQL arriving here is user-authored, exactly as it was when this function
 * interpolated it itself: panel SQL has always come from the dashboard document
 * the browser holds. So this runs through the per-org SQL API user, whose tenant
 * filter is a row policy bound to the user — not a `SETTINGS`-based filter a
 * malicious query could override to read another tenant's rows.
 */
export const executePanelSql = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      sql: z.string().min(1),
      params: z.record(z.string(), z.union([z.string(), z.number()])),
    }),
  )
  .handler(async ({ data: { sql, params }, context }) => {
    const rows = await querySqlApi<QueryRow>(
      sql,
      context.session.session.activeOrganizationId,
      params,
    );
    return { rows };
  });
