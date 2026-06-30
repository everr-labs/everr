import { notFound } from "@tanstack/react-router";
import { and, eq, sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db/client";
import { runbooks } from "@/db/schema";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { runbookSpecSchema } from "./schema";

export const getRunbook = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ project: z.string(), slug: z.string() }))
  .handler(async ({ data: { project, slug }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    const [row] = await db
      .select({
        document: runbooks.document,
        folderPath: runbooks.folderPath,
      })
      .from(runbooks)
      .where(
        and(
          eq(runbooks.organizationId, orgId),
          eq(runbooks.project, project),
          eq(runbooks.slug, slug),
        ),
      )
      .limit(1);

    if (!row) {
      // Throw a framework notFound so only a genuinely-missing runbook shows
      // the not-found UI; real errors (auth, server, invalid spec) surface as
      // errors instead.
      throw notFound();
    }

    // Validate the spec shape on read; return the stored document verbatim so
    // unknown fields survive (same lenient-read contract as dashboards).
    runbookSpecSchema.parse(row.document.spec);

    return { ...row.document, folderPath: row.folderPath };
  });

export const listRunbooks = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context }) => {
  const orgId = context.session.session.activeOrganizationId;

  const rows = await db
    .select({
      slug: runbooks.slug,
      project: runbooks.project,
      folderPath: runbooks.folderPath,
      displayName: sql<string>`document->'spec'->'display'->>'name'`,
      updatedAt: runbooks.updatedAt,
    })
    .from(runbooks)
    .where(eq(runbooks.organizationId, orgId));

  return rows.map((r) => ({
    slug: r.slug,
    project: r.project,
    name: r.displayName ?? r.slug,
    folderPath: r.folderPath,
    updatedAt: r.updatedAt.toISOString(),
  }));
});
