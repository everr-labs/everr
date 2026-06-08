import { DEFAULT_TIME_RANGE, resolveTimeRange } from "@everr/ui/lib/time-range";
import { notFound } from "@tanstack/react-router";
import { and, eq, sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db/client";
import { dashboards } from "@/db/schema";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { interpolateVariables } from "./interpolate";
import type { Dashboard } from "./schema";
import { dashboardSpecSchema } from "./schema";

export const getDashboard = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ source: z.string(), slug: z.string() }))
  .handler(async ({ data: { source, slug }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    const [row] = await db
      .select({ slug: dashboards.slug, spec: dashboards.spec })
      .from(dashboards)
      .where(
        and(
          eq(dashboards.organizationId, orgId),
          eq(dashboards.source, source),
          eq(dashboards.slug, slug),
        ),
      )
      .limit(1);

    if (!row) {
      // Throw a framework notFound so only a genuinely-missing dashboard shows
      // the not-found UI; real errors (auth, server, invalid spec) surface as
      // errors instead.
      throw notFound();
    }

    // Validate shape; return the raw stored spec so unknown Perses fields
    // survive read.
    dashboardSpecSchema.parse(row.spec);

    return {
      kind: "Dashboard",
      metadata: { name: row.slug },
      spec: row.spec,
    } satisfies Dashboard;
  });

export const listDashboards = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context }) => {
  const orgId = context.session.session.activeOrganizationId;

  const rows = await db
    .select({
      slug: dashboards.slug,
      source: dashboards.source,
      folderPath: dashboards.folderPath,
      displayName: sql<string>`spec->'display'->>'name'`,
    })
    .from(dashboards)
    .where(eq(dashboards.organizationId, orgId));

  return rows.map((r) => ({
    slug: r.slug,
    source: r.source,
    name: r.displayName ?? r.slug,
    folderPath: r.folderPath,
  }));
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
      variables: z
        .record(z.string(), z.union([z.string(), z.array(z.string())]))
        .optional(),
      variableMeta: z
        .record(
          z.string(),
          z.object({
            customAllValue: z.string().optional(),
            options: z.array(z.string()).optional(),
          }),
        )
        .optional(),
    }),
  )
  .handler(
    async ({ data: { sql, from, to, variables, variableMeta }, context }) => {
      const { fromISO, toISO } = resolveTimeRange({
        from: from ?? DEFAULT_TIME_RANGE.from,
        to: to ?? DEFAULT_TIME_RANGE.to,
      });
      const interpolated = variables
        ? interpolateVariables(sql, variables, variableMeta ?? {})
        : sql;
      const rows = await context.clickhouse.query<QueryRow>(interpolated, {
        from: fromISO,
        to: toISO,
      });
      return { rows };
    },
  );

const VARIABLE_OPTIONS_LIMIT = 1000;

export const runVariableOptionsQuery = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      query: z.string().min(1),
      from: z.string().optional(),
      to: z.string().optional(),
    }),
  )
  .handler(async ({ data: { query, from, to }, context }) => {
    const { fromISO, toISO } = resolveTimeRange({
      from: from ?? DEFAULT_TIME_RANGE.from,
      to: to ?? DEFAULT_TIME_RANGE.to,
    });
    const rows = await context.clickhouse.query<Record<string, unknown>>(
      query,
      {
        from: fromISO,
        to: toISO,
      },
    );

    // Options are the stringified first column, deduplicated, in query order,
    // capped at VARIABLE_OPTIONS_LIMIT with an explicit truncation flag.
    const seen = new Set<string>();
    const options: string[] = [];
    let truncated = false;
    for (const row of rows) {
      const values = Object.values(row);
      if (values.length === 0) continue;
      const option = String(values[0]);
      if (seen.has(option)) continue;
      seen.add(option);
      if (options.length >= VARIABLE_OPTIONS_LIMIT) {
        truncated = true;
        break;
      }
      options.push(option);
    }
    return { options, truncated };
  });
