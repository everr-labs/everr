import * as z from "zod";
import { panelPluginSpecs, queryPluginSpecs } from "./plugin-specs";

/** Recursive JSON-serializable value type for Perses plugin specs. */
export type PluginSpecValue =
  | string
  | number
  | boolean
  | null
  | PluginSpecValue[]
  | { [key: string]: PluginSpecValue };

const pluginSpecValue: z.ZodType<PluginSpecValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(pluginSpecValue),
    z.record(z.string(), pluginSpecValue),
  ]),
);

export const dashboardDisplay = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
});

export const panelPlugin = z.object({
  kind: z.string(),
  spec: z.record(z.string(), pluginSpecValue),
});

export const queryPlugin = z.object({
  kind: z.string(),
  spec: z.record(z.string(), pluginSpecValue),
});

export const panelQuery = z.object({
  kind: z.string(),
  spec: z.object({
    plugin: queryPlugin,
  }),
});

export const panel = z.object({
  kind: z.literal("Panel"),
  spec: z.object({
    // Optional to match Perses: a panel may carry only `plugin` (+ `queries`).
    // Validation must never be stricter than Perses; the UI falls back to the
    // panel key when no display name is present.
    display: dashboardDisplay.optional(),
    plugin: panelPlugin,
    queries: z.array(panelQuery).optional(),
  }),
});

/** Columns every dashboard grid is measured in, layout and renderer alike. */
export const GRID_COLS = 24;

/** Prefix every layout `content.$ref` must use to point at a panel key. */
export const PANEL_REF_PREFIX = "#/spec/panels/";

export const gridItem = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  content: z.object({ $ref: z.string() }),
});

export const gridLayout = z.object({
  kind: z.literal("Grid"),
  spec: z.object({
    display: z
      .object({
        title: z.string().optional(),
        collapse: z.object({ open: z.boolean() }).optional(),
      })
      .optional(),
    items: z.array(gridItem),
  }),
});

export const datasourceSpec = z.object({
  // Optional to match Perses (defaults to false there). Datasources have no
  // runtime effect in Everr — accepted only for compatibility — so validation
  // must never be stricter than Perses.
  default: z.boolean().optional(),
  plugin: z.object({
    kind: z.string(),
    spec: z.record(z.string(), pluginSpecValue),
  }),
});

export const variableDisplay = dashboardDisplay.extend({
  hidden: z.boolean().optional(),
});

export const textVariable = z.object({
  kind: z.literal("TextVariable"),
  spec: z.object({
    name: z.string(),
    display: variableDisplay.optional(),
    value: z.string(),
    constant: z.boolean().optional(),
  }),
});

export const listVariable = z.object({
  kind: z.literal("ListVariable"),
  spec: z.object({
    name: z.string(),
    display: variableDisplay.optional(),
    defaultValue: z.union([z.string(), z.array(z.string())]).optional(),
    allowAllValue: z.boolean().optional(),
    allowMultiple: z.boolean().optional(),
    customAllValue: z.string().optional(),
    capturingRegexp: z.string().optional(),
    sort: z
      .enum([
        "none",
        "alphabetical-asc",
        "alphabetical-desc",
        "numerical-asc",
        "numerical-desc",
        "alphabetical-ci-asc",
        "alphabetical-ci-desc",
      ])
      .optional(),
    plugin: z.object({
      kind: z.string(),
      spec: z.record(z.string(), pluginSpecValue),
    }),
  }),
});

export const variable = z.discriminatedUnion("kind", [
  textVariable,
  listVariable,
]);

export const dashboardSpecSchema = z
  .object({
    display: dashboardDisplay.optional(),
    datasources: z.record(z.string(), datasourceSpec).optional(),
    variables: z.array(variable).optional(),
    panels: z.record(z.string(), panel),
    layouts: z.array(gridLayout),
    duration: z.string().optional(),
    refreshInterval: z.string().optional(),
  })
  // Every layout item must point at an existing panel. Without this, a typo'd
  // $ref validates fine and then renders as a missing/silently-dropped panel.
  .superRefine((spec, ctx) => {
    spec.layouts.forEach((layout, li) => {
      layout.spec.items.forEach((item, ii) => {
        const ref = item.content.$ref;
        const path = ["layouts", li, "spec", "items", ii, "content", "$ref"];
        if (!ref.startsWith(PANEL_REF_PREFIX)) {
          ctx.addIssue({
            code: "custom",
            path,
            message: `Panel ref must start with "${PANEL_REF_PREFIX}"`,
          });
          return;
        }
        const key = ref.slice(PANEL_REF_PREFIX.length);
        if (!Object.hasOwn(spec.panels, key)) {
          ctx.addIssue({
            code: "custom",
            path,
            message: `Panel ref "${ref}" does not match any panel in spec.panels`,
          });
        }
      });
    });
  });

/**
 * Strict plugin/query spec issues for one panel, paths relative to the panel
 * object. Shared by the dashboard and runbook write-path validation.
 */
export function collectPanelStrictIssues(
  p: Panel,
): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = [];
  const pluginSchema = panelPluginSpecs[p.spec.plugin.kind];
  if (pluginSchema) {
    const result = pluginSchema.safeParse(p.spec.plugin.spec);
    if (!result.success) {
      for (const issue of result.error.issues) {
        issues.push({
          path: ["spec", "plugin", "spec", ...issue.path.map(String)],
          message: issue.message,
        });
      }
    }
  }
  (p.spec.queries ?? []).forEach((q, qi) => {
    const querySchema = queryPluginSpecs[q.spec.plugin.kind];
    if (!querySchema) return;
    const qResult = querySchema.safeParse(q.spec.plugin.spec);
    if (qResult.success) return;
    for (const issue of qResult.error.issues) {
      issues.push({
        path: [
          "spec",
          "queries",
          qi,
          "spec",
          "plugin",
          "spec",
          ...issue.path.map(String),
        ],
        message: issue.message,
      });
    }
  });
  return issues;
}

/**
 * Strict variant for the write path (`everr apply`): additionally validates
 * each panel's plugin spec against its visualization schema, so a typo'd
 * option fails the apply with a precise path instead of silently falling back
 * to a default at render time. Unknown plugin kinds still pass — they render
 * a placeholder, never break validation.
 *
 * The read path (`server.ts`) keeps the base schema on purpose: a stored
 * dashboard that predates validation must still load; the renderer parses
 * specs leniently and surfaces ignored options as panel warnings.
 */
export const dashboardSpecSchemaStrict = dashboardSpecSchema.superRefine(
  (spec, ctx) => {
    for (const [key, p] of Object.entries(spec.panels)) {
      for (const issue of collectPanelStrictIssues(p)) {
        ctx.addIssue({
          code: "custom",
          message: issue.message,
          path: ["panels", key, ...issue.path],
        });
      }
    }
  },
);

export type DashboardDisplay = z.infer<typeof dashboardDisplay>;
export type PanelPlugin = z.infer<typeof panelPlugin>;
export type QueryPlugin = z.infer<typeof queryPlugin>;
export type PanelQuery = z.infer<typeof panelQuery>;
export type Panel = z.infer<typeof panel>;
export type GridItem = z.infer<typeof gridItem>;
export type GridLayout = z.infer<typeof gridLayout>;
export type DatasourceSpec = z.infer<typeof datasourceSpec>;
export type TextVariable = z.infer<typeof textVariable>;
export type ListVariable = z.infer<typeof listVariable>;
export type Variable = z.infer<typeof variable>;
export type DashboardSpec = z.infer<typeof dashboardSpecSchema>;

export interface DashboardMetadata {
  name: string;
  /** Perses project namespace. Optional in files; defaults to "default". */
  project?: string;
}

export interface Dashboard {
  kind: "Dashboard";
  metadata: DashboardMetadata;
  spec: DashboardSpec;
}

/** Validates a dashboard slug: lowercase letters, digits and hyphens only. */
export const dashboardSlugSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    "Slug must use lowercase letters, digits and hyphens, and cannot start or end with a hyphen",
  );

/**
 * The reserved pseudo-project the catalog of Built-in dashboards is served
 * under — `/dashboards/built-in/$slug` and `everr resources show --project
 * built-in`. No user resource may claim it, or it would collide with the
 * pseudo-project in routes and the resources API (ADR 0004).
 */
export const BUILTIN_PROJECT = "built-in";

/** Validates a project name: lowercase letters, digits and hyphens only. */
export const dashboardProjectSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    "Project must use lowercase letters, digits and hyphens, and cannot start or end with a hyphen",
  )
  .refine((project) => project !== BUILTIN_PROJECT, {
    message: `"${BUILTIN_PROJECT}" is reserved for Everr's built-in dashboards`,
  });
