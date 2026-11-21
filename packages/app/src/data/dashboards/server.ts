import { bucketSeconds, bucketStartMs } from "@everr/ui/lib/bucket";
import {
  resolveTimeRange,
  toClickHouseDateTimeSeconds,
  withTimeRange,
} from "@everr/ui/lib/time-range";
import { notFound } from "@tanstack/react-router";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as z from "zod";
import { identityKey } from "#app/data/as-code/reconcile.ts";
import { overlayPreview, type PreviewStatus } from "#app/data/previews/overlay.ts";
import { getCoveredRepoids } from "#app/data/previews/repoids.ts";
import { effectiveRepoid, liveOrPreview, previewJoin } from "#app/data/previews/scope.ts";
import { db } from "#app/db/client.ts";
import { dashboards, previews } from "#app/db/schema/index.ts";
import { createAuthenticatedServerFn } from "#app/lib/serverFn.ts";
import {
  buildCapabilitiesQuery,
  type CapabilityRow,
  decodeCapabilityRows,
} from "./built-in/capabilities";
import { interpolateVariables } from "./interpolate";
import { dashboardFromResource } from "./normalize";
import type { DashboardResource } from "./schema";
import { dashboardSpecSchema } from "./schema";
import { generateTestData } from "./testdata/generate";
import { testDataSpec } from "./testdata/spec";

/** A time-series panel targets ~this many points; `step` is sized to hit it. */
const PANEL_TARGET_POINTS = 500;

/**
 * Shared panel and variable parameters, including the adaptive `{step}`. The
 * app sends the range already resolved in the viewer's zone; a relative range
 * from an older client still resolves here. Bounds are rounded
 * outward to whole seconds because DateTime columns refuse fractional literals.
 * `window` is the exact range the query covers, returned to the client so the
 * panel axis renders over it.
 *
 * With `alignToStep`, for panels drawn over time, the start moves back to the
 * step's grid, so the first bucket is whole and starts on the axis instead of
 * reading low at the left edge. The end stays the real end, so the axis
 * reaches the present. The step comes from the range as given, so aligning
 * can't change it.
 */
function resolveDashboardQuery({
  alignToStep = false,
  ...range
}: {
  from?: string;
  to?: string;
  alignToStep?: boolean;
}) {
  const { fromDate, toDate } = resolveTimeRange(withTimeRange(range));
  const step = bucketSeconds(fromDate, toDate, PANEL_TARGET_POINTS);
  const from = new Date(bucketStartMs(fromDate.getTime(), alignToStep ? step : 1, 0));
  const to = new Date(Math.ceil(toDate.getTime() / 1000) * 1000);
  return {
    params: {
      from: toClickHouseDateTimeSeconds(from, "floor"),
      to: toClickHouseDateTimeSeconds(to, "ceil"),
      step,
    },
    window: { from: from.toISOString(), to: to.toISOString() },
  };
}

export const getDashboard = createAuthenticatedServerFn({ method: "GET" })
  .validator(
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
      return {
        document: dashboardFromResource(row.document),
        previewStatus,
      };
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
    const overlaid = overlayPreview({
      rows,
      coveredRepoids: covered,
      identity: identityKey,
      // A dashboard's declared content is its document plus where the tree puts
      // it, so a pure move still reads as changed.
      content: (row) => [row.folderPath, row.document],
    });
    // Prefer a surviving row; a shadowed-by-deletion live row still renders,
    // marked "removed", instead of 404ing mid-review.
    const row =
      overlaid.find((r) => r.previewStatus !== "removed") ??
      overlaid.find((r) => r.previewStatus === "removed");
    if (!row) throw notFound();
    dashboardSpecSchema.parse(row.document.spec);
    return {
      document: dashboardFromResource(row.document satisfies DashboardResource),
      previewStatus: row.previewStatus,
    };
  });

export const listDashboards = createAuthenticatedServerFn({ method: "GET" })
  .validator(z.object({ preview: z.string().optional() }).optional())
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
        .where(and(eq(dashboards.organizationId, orgId), isNull(dashboards.previewId)));
      return rows.map(toItem);
    }

    const [covered, rows] = await Promise.all([
      getCoveredRepoids(orgId, preview),
      db
        .select(previewSelect)
        .from(dashboards)
        .leftJoin(previews, previewJoin(dashboards))
        .where(and(eq(dashboards.organizationId, orgId), liveOrPreview(dashboards, preview))),
    ]);
    return overlayPreview({
      rows,
      coveredRepoids: covered,
      identity: identityKey,
      // A dashboard's declared content is its document plus where the tree puts
      // it, so a pure move still reads as changed.
      content: (row) => [row.folderPath, row.document],
    }).map(toItem);
  });

/**
 * What the Organization is sending right now, in the same window the
 * dashboards render. The built-in list grades readiness against this, so a
 * built-in marked ready and a dashboard that draws nothing can never disagree.
 */
export const getTelemetryCapabilities = createAuthenticatedServerFn({
  method: "GET",
})
  .validator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data: { from, to }, context }) => {
    const { fromISO, toISO } = resolveTimeRange({ from, to });
    const rows = await context.sql.query<CapabilityRow>(buildCapabilitiesQuery(), {
      from: fromISO,
      to: toISO,
    });
    return decodeCapabilityRows(rows);
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
  .validator(
    z.object({
      source: querySource,
      from: z.string().optional(),
      to: z.string().optional(),
      alignToStep: z.boolean(),
      variables: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
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
  .handler(async ({ data: { source, variables, variableMeta, ...range }, context }) => {
    const { params, window } = resolveDashboardQuery(range);
    // Synthetic data for the gallery / dev dashboards: deterministic, no
    // ClickHouse, no tenant data. Reuses the same range + adaptive {step}.
    if (source.kind === "TestData") {
      // Parse the loose spec here (not in the input validator) so the client
      // can pass the raw plugin spec. A malformed spec throws → surfaces as a
      // panel query error; the gallery's specs are validated at apply time.
      const spec = testDataSpec.parse(source.spec);
      return { rows: generateTestData(spec, params), timeRange: window };
    }

    const interpolated = variables
      ? interpolateVariables(source.sql, variables, variableMeta ?? {})
      : source.sql;
    // User-supplied SQL: run it through the per-org SQL API user, whose tenant
    // filter is a row policy bound to the user — not a `SETTINGS`-based filter
    // a malicious query could override to read another tenant's rows.
    const rows = await context.sql.query<QueryRow>(interpolated, params);
    return { rows, timeRange: window };
  });

// Hard-capped by the SQL API profile's `max_result_rows` (packages/app/clickhouse/
// 0008-create-sql-api-profile.sql). That profile uses result_overflow_mode='throw',
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
  .validator(
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
    const rows = await context.sql.query<Record<string, unknown>>(
      withRowLimit(query, VARIABLE_OPTIONS_LIMIT),
      resolveDashboardQuery({ from, to }).params,
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
