import { DEFAULT_TIME_RANGE, resolveTimeRange } from "@everr/ui/lib/time-range";
import { notFound } from "@tanstack/react-router";
import { and, eq, sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db/client";
import { dashboards } from "@/db/schema";
import { querySqlApi } from "@/lib/clickhouse";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { computeStepSeconds } from "./bucket";
import { interpolateVariables } from "./interpolate";
import type { Dashboard } from "./schema";
import { dashboardSpecSchema } from "./schema";

export const getDashboard = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ project: z.string(), slug: z.string() }))
  .handler(async ({ data: { project, slug }, context }) => {
    const orgId = context.session.session.activeOrganizationId;

    const [row] = await db
      .select({ document: dashboards.document })
      .from(dashboards)
      .where(
        and(
          eq(dashboards.organizationId, orgId),
          eq(dashboards.project, project),
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

    // Validate the spec shape on read; return the stored document verbatim so
    // unknown Perses fields survive.
    dashboardSpecSchema.parse(row.document.spec);

    return row.document satisfies Dashboard;
  });

export const listDashboards = createAuthenticatedServerFn({
  method: "GET",
}).handler(async ({ context }) => {
  const orgId = context.session.session.activeOrganizationId;

  const rows = await db
    .select({
      slug: dashboards.slug,
      project: dashboards.project,
      folderPath: dashboards.folderPath,
      displayName: sql<string>`document->'spec'->'display'->>'name'`,
    })
    .from(dashboards)
    .where(eq(dashboards.organizationId, orgId));

  return rows.map((r) => ({
    slug: r.slug,
    project: r.project,
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
      // User-supplied SQL: run it through the per-org SQL API user, whose tenant
      // filter is a row policy bound to the user — not a `SETTINGS`-based filter
      // a malicious query could override to read another tenant's rows.
      //
      // `step` is the adaptive bucket width (seconds) for the selected range, so
      // a chart can `toStartOfInterval(col, INTERVAL {step:UInt32} SECOND)` and
      // stay ~bounded in point count at any zoom. Bound alongside from/to as a
      // ClickHouse query parameter; queries that don't reference it ignore it.
      const rows = await querySqlApi<QueryRow>(
        interpolated,
        context.session.session.activeOrganizationId,
        { from: fromISO, to: toISO, step: computeStepSeconds(fromISO, toISO) },
      );
      return { rows };
    },
  );

// Hard-capped by the SQL API profile's `max_result_rows` (clickhouse/init/
// 15-create-sql-api-role.sql). That profile uses result_overflow_mode='throw',
// so a query returning more than this ERRORS rather than truncating — the cap
// must be enforced in SQL (see withRowLimit), not after the fetch.
const VARIABLE_OPTIONS_LIMIT = 1000;

/**
 * Bound a user-supplied options query to at most `limit` rows by wrapping it,
 * so the SQL API profile never throws on overflow. Wrapping (vs appending
 * `LIMIT`) preserves any `ORDER BY`/`LIMIT` the query already has; the trailing
 * semicolon is stripped so the subquery stays valid.
 */
function withRowLimit(query: string, limit: number): string {
  const inner = query.trim().replace(/;\s*$/, "");
  return `SELECT * FROM (\n${inner}\n) LIMIT ${limit}`;
}

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
    // User-supplied SQL: run it through the per-org SQL API user (row-policy
    // tenant isolation), not the SETTINGS-based app path it could override. The
    // LIMIT is injected into the SQL because the SQL API profile THROWS on
    // result overflow — capping after the fetch would never run for large sets.
    const rows = await querySqlApi<Record<string, unknown>>(
      withRowLimit(query, VARIABLE_OPTIONS_LIMIT),
      context.session.session.activeOrganizationId,
      {
        from: fromISO,
        to: toISO,
      },
    );

    // A full result set means ClickHouse cut rows off at the limit, so there may
    // be more options than we can show — surface that as truncation.
    const truncated = rows.length >= VARIABLE_OPTIONS_LIMIT;

    // Options are the stringified first column, deduplicated, in query order.
    const seen = new Set<string>();
    const options: string[] = [];
    for (const row of rows) {
      const values = Object.values(row);
      if (values.length === 0) continue;
      const option = String(values[0]);
      if (seen.has(option)) continue;
      seen.add(option);
      options.push(option);
    }
    return { options, truncated };
  });
