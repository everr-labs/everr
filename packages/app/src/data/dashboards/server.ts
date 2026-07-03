import { bucketSeconds } from "@everr/ui/lib/bucket";
import { DEFAULT_TIME_RANGE, resolveTimeRange } from "@everr/ui/lib/time-range";
import { notFound } from "@tanstack/react-router";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as z from "zod";
import { overlayPreview, type PreviewStatus } from "@/data/previews/overlay";
import { getCoveredRepoids } from "@/data/previews/repoids";
import { db } from "@/db/client";
import { dashboards } from "@/db/schema";
import { querySqlApi } from "@/lib/clickhouse";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { interpolateVariables } from "./interpolate";
import type { Dashboard } from "./schema";
import { dashboardSpecSchema } from "./schema";
import { generateTestData } from "./testdata/generate";
import { testDataSpec } from "./testdata/spec";

/** A time-series panel targets ~this many points; `step` is sized to hit it. */
const PANEL_TARGET_POINTS = 500;

/**
 * The ClickHouse query parameters bound to every dashboard query (panel and
 * variable-options alike), so the documented contract — `{from}`/`{to}` plus an
 * adaptive `{step:UInt32}` bucket width — holds for all of them by construction.
 * `from`/`to` are the resolved range; `step` is the adaptive bucket width
 * (seconds) so a chart can `toStartOfInterval(col, INTERVAL {step:UInt32}
 * SECOND)` and stay ~bounded in point count at any zoom. Queries that don't
 * reference a parameter simply ignore it.
 */
function dashboardQueryParams(range: { from?: string; to?: string }) {
  const { fromDate, toDate, fromISO, toISO } = resolveTimeRange({
    from: range.from ?? DEFAULT_TIME_RANGE.from,
    to: range.to ?? DEFAULT_TIME_RANGE.to,
  });
  return {
    from: fromISO,
    to: toISO,
    step: bucketSeconds(fromDate, toDate, PANEL_TARGET_POINTS),
  };
}

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
    const preview = rest.preview ?? "";

    const identity = and(
      eq(dashboards.organizationId, orgId),
      eq(dashboards.project, project),
      eq(dashboards.slug, slug),
    );

    if (preview === "") {
      const [row] = await db
        .select({ document: dashboards.document })
        .from(dashboards)
        .where(and(identity, eq(dashboards.preview, "")))
        .limit(1);
      if (!row) throw notFound();
      dashboardSpecSchema.parse(row.document.spec);
      return {
        document: row.document satisfies Dashboard,
        previewStatus: undefined as PreviewStatus | undefined,
      };
    }

    const [covered, rows] = await Promise.all([
      getCoveredRepoids(orgId, preview),
      db
        .select({
          repoid: dashboards.repoid,
          preview: dashboards.preview,
          project: dashboards.project,
          slug: dashboards.slug,
          folderPath: dashboards.folderPath,
          document: dashboards.document,
        })
        .from(dashboards)
        .where(and(identity, inArray(dashboards.preview, ["", preview]))),
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
    const preview = data?.preview ?? "";

    // Live path never diffs against anything, so it only needs the scalar
    // columns `toItem` returns — no `document` (expensive JSONB) fetch. The
    // preview path feeds `overlayPreview`, which diffs `document` and keys off
    // `repoid`/`preview`, so it keeps those.
    const liveSelect = {
      slug: dashboards.slug,
      project: dashboards.project,
      folderPath: dashboards.folderPath,
      displayName: sql<string>`document->'spec'->'display'->>'name'`,
    };

    const previewSelect = {
      repoid: dashboards.repoid,
      preview: dashboards.preview,
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

    if (preview === "") {
      const rows = await db
        .select(liveSelect)
        .from(dashboards)
        .where(
          and(eq(dashboards.organizationId, orgId), eq(dashboards.preview, "")),
        );
      return rows.map(toItem);
    }

    // Preview mode: the end result of the apply — preview rows replace live
    // rows for covered repoids; everything else shows as-is, diff-tagged.
    const [covered, rows] = await Promise.all([
      getCoveredRepoids(orgId, preview),
      db
        .select(previewSelect)
        .from(dashboards)
        .where(
          and(
            eq(dashboards.organizationId, orgId),
            inArray(dashboards.preview, ["", preview]),
          ),
        ),
    ]);
    return overlayPreview({ rows, coveredRepoids: covered }).map(toItem);
  });

type QueryRow = Record<string, string | number | boolean | null>;

const querySource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ClickHouseSQL"), sql: z.string().min(1) }),
  z.object({
    kind: z.literal("TestData"),
    spec: z.record(z.string(), z.unknown()),
  }),
]);

export const runPanelQuery = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(
    z.object({
      source: querySource,
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
    async ({
      data: { source, from, to, variables, variableMeta },
      context,
    }) => {
      // Synthetic data for the gallery / dev dashboards: deterministic, no
      // ClickHouse, no tenant data. Reuses the same range + adaptive {step}.
      if (source.kind === "TestData") {
        // Parse the loose spec here (not in the input validator) so the client
        // can pass the raw plugin spec. A malformed spec throws → surfaces as a
        // panel query error; the gallery's specs are validated at apply time.
        const spec = testDataSpec.parse(source.spec);
        return {
          rows: generateTestData(spec, dashboardQueryParams({ from, to })),
        };
      }

      const interpolated = variables
        ? interpolateVariables(source.sql, variables, variableMeta ?? {})
        : source.sql;
      // User-supplied SQL: run it through the per-org SQL API user, whose tenant
      // filter is a row policy bound to the user — not a `SETTINGS`-based filter
      // a malicious query could override to read another tenant's rows.
      const rows = await querySqlApi<QueryRow>(
        interpolated,
        context.session.session.activeOrganizationId,
        dashboardQueryParams({ from, to }),
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
    // User-supplied SQL: run it through the per-org SQL API user (row-policy
    // tenant isolation), not the SETTINGS-based app path it could override. The
    // LIMIT is injected into the SQL because the SQL API profile THROWS on
    // result overflow — capping after the fetch would never run for large sets.
    // Bind the same parameters as a panel query (including `{step}`) so an
    // options query can reference any of them without erroring.
    const rows = await querySqlApi<Record<string, unknown>>(
      withRowLimit(query, VARIABLE_OPTIONS_LIMIT),
      context.session.session.activeOrganizationId,
      dashboardQueryParams({ from, to }),
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
