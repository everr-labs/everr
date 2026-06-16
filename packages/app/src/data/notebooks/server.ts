import { notFound } from "@tanstack/react-router";
import { and, eq, sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db/client";
import { notebooks } from "@/db/schema";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import type { Notebook } from "./schema";
import { notebookSpecSchema } from "./schema";

export const getNotebook = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ project: z.string(), slug: z.string() }))
  .handler(async ({ data: { project, slug }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    const [row] = await db
      .select({ document: notebooks.document })
      .from(notebooks)
      .where(
        and(
          eq(notebooks.organizationId, orgId),
          eq(notebooks.project, project),
          eq(notebooks.slug, slug),
        ),
      )
      .limit(1);

    if (!row) {
      // Throw a framework notFound so only a genuinely-missing notebook shows
      // the not-found UI; real errors (auth, server, invalid spec) surface as
      // errors instead.
      throw notFound();
    }

    // Validate the spec shape on read; return the stored document verbatim so
    // unknown fields survive (same lenient-read contract as dashboards).
    notebookSpecSchema.parse(row.document.spec);

    return row.document satisfies Notebook;
  });

export const listNotebooks = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context }) => {
  const orgId = context.session.session.activeOrganizationId;

  const rows = await db
    .select({
      slug: notebooks.slug,
      project: notebooks.project,
      folderPath: notebooks.folderPath,
      displayName: sql<string>`document->'spec'->'display'->>'name'`,
    })
    .from(notebooks)
    .where(eq(notebooks.organizationId, orgId));

  return rows.map((r) => ({
    slug: r.slug,
    project: r.project,
    name: r.displayName ?? r.slug,
    folderPath: r.folderPath,
  }));
});
