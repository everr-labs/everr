import * as z from "zod";

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
    display: dashboardDisplay,
    plugin: panelPlugin,
    queries: z.array(panelQuery).optional(),
  }),
});

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
  default: z.boolean(),
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

export const dashboardSpecSchema = z.object({
  display: dashboardDisplay.optional(),
  datasources: z.record(z.string(), datasourceSpec).optional(),
  variables: z.array(variable).optional(),
  panels: z.record(z.string(), panel),
  layouts: z.array(gridLayout),
  duration: z.string().optional(),
  refreshInterval: z.string().optional(),
});

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
}

export interface Dashboard {
  kind: "Dashboard";
  metadata: DashboardMetadata;
  spec: DashboardSpec;
}

export const saveDashboardInput = z.object({
  slug: z.string().min(1).max(200),
  spec: dashboardSpecSchema,
  folderId: z.string().uuid().optional(),
});

export const deleteDashboardInput = z.object({
  slug: z.string().min(1),
});

export const createFolderInput = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().uuid().optional(),
});

export const renameFolderInput = z.object({
  folderId: z.string().uuid(),
  name: z.string().min(1).max(200),
});

export const deleteFolderInput = z.object({
  folderId: z.string().uuid(),
  mode: z.enum(["cascade", "move-to-root"]),
});

export const renameDashboardInput = z.object({
  slug: z.string().min(1),
  name: z.string().min(1).max(200),
});

export const moveDashboardInput = z.object({
  slug: z.string().min(1),
  folderId: z.string().uuid().nullable(),
});

export const moveFolderInput = z.object({
  folderId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
});
