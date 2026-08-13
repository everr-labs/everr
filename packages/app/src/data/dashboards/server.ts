import { bucketSeconds } from "@everr/ui/lib/bucket";
import { DEFAULT_TIME_RANGE, resolveTimeRange } from "@everr/ui/lib/time-range";
import { notFound } from "@tanstack/react-router";
import { and, eq, isNull, sql } from "drizzle-orm";
import * as z from "zod";
import { deleteResource } from "@/data/as-code/resource-admin.server";
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
import { interpolateVariables } from "./interpolate";
import type { Dashboard } from "./schema";
import {
  dashboardProjectSchema,
  dashboardSlugSchema,
  dashboardSpecSchema,
  dashboardSpecSchemaStrict,
} from "./schema";
import {
  buildCapabilitiesQuery,
  type CapabilityRow,
  decodeCapabilityRows,
} from "./templates/capabilities";
import { getTemplate } from "./templates/catalog";
import { generateTestData } from "./testdata/generate";
import { testDataSpec } from "./testdata/spec";
import { isUiOwned, plannedSlug, UI_REPOID } from "./ui-owned";

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
    const preview = rest.preview ?? null;

    const identity = and(
      eq(dashboards.organizationId, orgId),
      eq(dashboards.project, project),
      eq(dashboards.slug, slug),
    );

    if (preview === null) {
      const [row] = await db
        .select({ document: dashboards.document, repoid: dashboards.repoid })
        .from(dashboards)
        .where(and(identity, isNull(dashboards.previewId)))
        .limit(1);
      if (!row) throw notFound();
      dashboardSpecSchema.parse(row.document.spec);
      // Typed binding (not an assertion) so the live and preview branches share
      // one return shape without widening `undefined` via a cast.
      const previewStatus: PreviewStatus | undefined = undefined;
      return {
        document: row.document satisfies Dashboard,
        uiOwned: isUiOwned(row.repoid),
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
      uiOwned: isUiOwned(row.repoid),
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
      repoid: dashboards.repoid,
      slug: dashboards.slug,
      project: dashboards.project,
      folderPath: dashboards.folderPath,
      displayName: sql<string>`document->'spec'->'display'->>'name'`,
      template: sql<string | null>`document->'metadata'->>'template'`,
    };

    const previewSelect = {
      repoid: effectiveRepoid(dashboards),
      previewId: dashboards.previewId,
      slug: dashboards.slug,
      project: dashboards.project,
      folderPath: dashboards.folderPath,
      document: dashboards.document,
      displayName: sql<string>`document->'spec'->'display'->>'name'`,
      template: sql<string | null>`document->'metadata'->>'template'`,
    };

    const toItem = (row: {
      repoid?: string | null;
      slug: string;
      project: string;
      folderPath: string;
      displayName: string | null;
      template?: string | null;
      previewStatus?: PreviewStatus;
    }) => ({
      slug: row.slug,
      project: row.project,
      name: row.displayName ?? row.slug,
      folderPath: row.folderPath,
      // Surfaced so the list can mark the ones made in the app: those are
      // editable in place, where an as-code Dashboard is owned by a repository.
      uiOwned: isUiOwned(row.repoid),
      template: row.template ?? null,
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

/**
 * What the Organization is sending right now, in the same window the previews
 * render. The gallery grades templates against this, so a template marked ready
 * and a preview that draws nothing can never disagree.
 */
export const getTelemetryCapabilities = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ from: z.string(), to: z.string() }))
  .handler(async ({ data: { from, to }, context }) => {
    const { fromISO, toISO } = resolveTimeRange({ from, to });
    const rows = await querySqlApi<CapabilityRow>(
      buildCapabilitiesQuery(),
      context.session.session.activeOrganizationId,
      { from: fromISO, to: toISO },
    );
    return decodeCapabilityRows(rows);
  });

/**
 * Create a Dashboard the Organization owns from a catalog template.
 *
 * The document is copied, not referenced: the new Dashboard has no link back to
 * the template, and later catalog changes never touch it. It is filed under
 * `UI_REPOID`, a boundary `everr apply` never reconciles, so a repository apply
 * cannot prune a Dashboard it has never seen. From here on, editing is the
 * normal flow — a prompt handoff to an Agent that applies the YAML.
 */
export const createDashboardFromTemplate = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ templateId: z.string() }))
  .handler(async ({ data: { templateId }, context }) => {
    const orgId = context.session.session.activeOrganizationId;
    const template = getTemplate(templateId);
    if (!template) throw new Error(`Unknown template: ${templateId}`);

    const project = template.document.metadata.project ?? "default";

    // Live identity is (org, project, slug) across every Repoid, so a second
    // copy — or a collision with an as-code Dashboard — needs its own slug.
    // Read the taken ones once and pick, rather than retrying on the unique
    // index and guessing which constraint fired.
    const taken = (
      await db
        .select({ slug: dashboards.slug })
        .from(dashboards)
        .where(
          and(
            eq(dashboards.organizationId, orgId),
            eq(dashboards.project, project),
            isNull(dashboards.previewId),
          ),
        )
    ).map((row) => row.slug);

    const slug = plannedSlug(template.id, taken);

    const document: Dashboard = {
      ...template.document,
      metadata: {
        ...template.document.metadata,
        name: slug,
        project,
        template: template.id,
      },
    };

    // The same gate `everr apply` puts in front of a Dashboard document. The
    // catalog is checked by `validateCatalog` in tests, but tests do not guard
    // the write: this is the one place a template becomes a stored row, so it
    // validates here rather than trusting where the document came from.
    dashboardProjectSchema.parse(project);
    dashboardSlugSchema.parse(slug);
    dashboardSpecSchemaStrict.parse(document.spec);

    await db.insert(dashboards).values({
      organizationId: orgId,
      repoid: UI_REPOID,
      previewId: null,
      project,
      slug,
      folderPath: "",
      document,
    });

    return { project, slug };
  });

/**
 * Delete a Dashboard the app created.
 *
 * Scoped to `UI_REPOID` through the shared resource seam, so the statement is
 * unable to name a row a repository owns — an as-code Dashboard is defined by
 * files, and its removal belongs to `everr apply`. A Dashboard adopted into a
 * repository has left the boundary and stops being deletable here, which is the
 * intended one-way door.
 */
export const deleteUiDashboard = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ project: z.string(), slug: z.string() }))
  .handler(async ({ data: { project, slug }, context }) => {
    const deleted = await deleteResource(
      context.session.session.activeOrganizationId,
      "dashboard",
      project,
      slug,
      UI_REPOID,
    );
    if (!deleted) {
      throw new Error(
        "That dashboard is owned by a repository. Remove it from its files and run everr apply.",
      );
    }
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
