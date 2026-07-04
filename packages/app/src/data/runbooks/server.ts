import { notFound } from "@tanstack/react-router";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import * as z from "zod";
import { overlayPreview, type PreviewStatus } from "@/data/previews/overlay";
import { getCoveredRepoids } from "@/data/previews/repoids";
import { db } from "@/db/client";
import { previews, runbooks } from "@/db/schema";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import type { Runbook } from "./schema";
import { runbookSpecSchema } from "./schema";

export const getRunbook = createAuthenticatedServerFn({ method: "GET" })
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
      eq(runbooks.organizationId, orgId),
      eq(runbooks.project, project),
      eq(runbooks.slug, slug),
    );

    if (preview === null) {
      const [row] = await db
        .select({ document: runbooks.document })
        .from(runbooks)
        .where(and(identity, isNull(runbooks.previewId)))
        .limit(1);
      if (!row) throw notFound();
      runbookSpecSchema.parse(row.document.spec);
      return {
        document: row.document satisfies Runbook,
        previewStatus: undefined as PreviewStatus | undefined,
      };
    }

    // Live rows (previewId NULL) plus this preview's rows. repoid/name come from
    // the joined registry row for preview rows, from the row itself for live.
    const [covered, rows] = await Promise.all([
      getCoveredRepoids(orgId, preview),
      db
        .select({
          repoid: sql<string>`coalesce(${runbooks.repoid}, ${previews.repoid})`,
          previewId: runbooks.previewId,
          project: runbooks.project,
          slug: runbooks.slug,
          folderPath: runbooks.folderPath,
          document: runbooks.document,
        })
        .from(runbooks)
        .leftJoin(previews, eq(runbooks.previewId, previews.id))
        .where(
          and(
            identity,
            or(isNull(runbooks.previewId), eq(previews.name, preview)),
          ),
        ),
    ]);
    const overlaid = overlayPreview({ rows, coveredRepoids: covered });
    // Prefer a surviving row; a shadowed-by-deletion live row still renders,
    // marked "removed", instead of 404ing mid-review.
    const row =
      overlaid.find((r) => r.previewStatus !== "removed") ??
      overlaid.find((r) => r.previewStatus === "removed");
    if (!row) throw notFound();
    runbookSpecSchema.parse(row.document.spec);
    return {
      document: row.document satisfies Runbook,
      previewStatus: row.previewStatus,
    };
  });

export const listRunbooks = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ preview: z.string().optional() }).optional())
  .handler(async ({ data, context }) => {
    const orgId = context.session.session.activeOrganizationId;
    const preview = data?.preview ?? null;

    // Live path never diffs against anything, so it only needs the scalar
    // columns `toItem` returns — no `document` (expensive JSONB) fetch. The
    // preview path feeds `overlayPreview`, which diffs `document` and keys off
    // `repoid`/`preview`, so it keeps those.
    const liveSelect = {
      slug: runbooks.slug,
      project: runbooks.project,
      folderPath: runbooks.folderPath,
      displayName: sql<string>`document->'spec'->'display'->>'name'`,
    };

    const previewSelect = {
      repoid: sql<string>`coalesce(${runbooks.repoid}, ${previews.repoid})`,
      previewId: runbooks.previewId,
      slug: runbooks.slug,
      project: runbooks.project,
      folderPath: runbooks.folderPath,
      document: runbooks.document,
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
        .from(runbooks)
        .where(
          and(eq(runbooks.organizationId, orgId), isNull(runbooks.previewId)),
        );
      return rows.map(toItem);
    }

    const [covered, rows] = await Promise.all([
      getCoveredRepoids(orgId, preview),
      db
        .select(previewSelect)
        .from(runbooks)
        .leftJoin(previews, eq(runbooks.previewId, previews.id))
        .where(
          and(
            eq(runbooks.organizationId, orgId),
            or(isNull(runbooks.previewId), eq(previews.name, preview)),
          ),
        ),
    ]);
    return overlayPreview({ rows, coveredRepoids: covered }).map(toItem);
  });
