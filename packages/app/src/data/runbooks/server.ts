import { notFound } from "@tanstack/react-router";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as z from "zod";
import { overlayPreview, type PreviewStatus } from "@/data/previews/overlay";
import { getCoveredRepoids } from "@/data/previews/repoids";
import { db } from "@/db/client";
import { runbooks } from "@/db/schema";
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
    const preview = rest.preview ?? "";

    const identity = and(
      eq(runbooks.organizationId, orgId),
      eq(runbooks.project, project),
      eq(runbooks.slug, slug),
    );

    if (preview === "") {
      const [row] = await db
        .select({ document: runbooks.document })
        .from(runbooks)
        .where(and(identity, eq(runbooks.preview, "")))
        .limit(1);
      if (!row) throw notFound();
      runbookSpecSchema.parse(row.document.spec);
      return {
        document: row.document satisfies Runbook,
        previewStatus: undefined as PreviewStatus | undefined,
      };
    }

    const [covered, rows] = await Promise.all([
      getCoveredRepoids(orgId, preview),
      db
        .select({
          repoid: runbooks.repoid,
          preview: runbooks.preview,
          project: runbooks.project,
          slug: runbooks.slug,
          folderPath: runbooks.folderPath,
          document: runbooks.document,
        })
        .from(runbooks)
        .where(and(identity, inArray(runbooks.preview, ["", preview]))),
    ]);
    const overlaid = overlayPreview({
      live: rows.filter((row) => row.preview === ""),
      previewRows: rows.filter((row) => row.preview !== ""),
      coveredRepoids: covered,
    });
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
    const preview = data?.preview ?? "";

    const select = {
      repoid: runbooks.repoid,
      preview: runbooks.preview,
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

    if (preview === "") {
      const rows = await db
        .select(select)
        .from(runbooks)
        .where(
          and(eq(runbooks.organizationId, orgId), eq(runbooks.preview, "")),
        );
      return rows.map(toItem);
    }

    // Preview mode: the end result of the apply — preview rows replace live
    // rows for covered repoids; everything else shows as-is, diff-tagged.
    const [covered, rows] = await Promise.all([
      getCoveredRepoids(orgId, preview),
      db
        .select(select)
        .from(runbooks)
        .where(
          and(
            eq(runbooks.organizationId, orgId),
            inArray(runbooks.preview, ["", preview]),
          ),
        ),
    ]);
    return overlayPreview({
      live: rows.filter((row) => row.preview === ""),
      previewRows: rows.filter((row) => row.preview !== ""),
      coveredRepoids: covered,
    }).map(toItem);
  });
