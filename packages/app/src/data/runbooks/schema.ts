import * as z from "zod";
import {
  collectPanelStrictIssues,
  dashboardDisplay,
  dashboardSlugSchema,
  panel,
  variable,
} from "@/data/dashboards/schema";

/**
 * A markdown body: authored as either inline content or a `file:` pointer
 * relative to the runbook YAML. The CLI resolves `file:` to `inline` at apply
 * time, so the server only ever accepts/stores the inline form.
 */
export interface MarkdownSource {
  inline?: string;
  file?: string;
}

const markdownSource: z.ZodType<MarkdownSource> = z
  .strictObject({
    inline: z.string().optional(),
    file: z.string().optional(),
  })
  .superRefine((src, ctx) => {
    if (typeof src.inline === "string") return;
    ctx.addIssue({
      code: "custom",
      path: ["inline"],
      message:
        typeof src.file === "string"
          ? 'unresolved markdown "file" pointer — file paths are inlined by the everr CLI at apply time; apply a directory with the CLI or provide "inline"'
          : 'markdown requires "inline" content',
    });
  });

export interface RunbookPage {
  name: string;
  display?: z.infer<typeof dashboardDisplay>;
  markdown: MarkdownSource;
  pages?: RunbookPage[];
}

// strictObject: page fields are our own spec, not Perses, so an unknown key is
// always an authoring typo (e.g. `pagse:`). z.object would silently strip it,
// and since apply stores the raw document, the misspelled field would survive
// in storage but be ignored by the viewer — content vanishing with no error.
const runbookPage: z.ZodType<RunbookPage> = z.lazy(() =>
  z.strictObject({
    name: dashboardSlugSchema,
    display: dashboardDisplay.optional(),
    markdown: markdownSource,
    pages: z.array(runbookPage).optional(),
  }),
);

/** Reject duplicate page names among siblings, recursively. */
function addDuplicatePageIssues(
  pages: RunbookPage[] | undefined,
  ctx: z.RefinementCtx,
  basePath: (string | number)[],
): void {
  if (!pages) return;
  const seen = new Set<string>();
  pages.forEach((page, i) => {
    if (seen.has(page.name)) {
      ctx.addIssue({
        code: "custom",
        path: [...basePath, i, "name"],
        message: `duplicate page name "${page.name}" among sibling pages`,
      });
    } else {
      seen.add(page.name);
    }
    addDuplicatePageIssues(page.pages, ctx, [...basePath, i, "pages"]);
  });
}

// strictObject for the same reason as runbookPage: these top-level keys are
// our own spec, so an unknown one is a typo to reject, not a field to drop.
// Leniency toward Perses lives inside the imported `panel`/`variable`/`display`
// schemas, which are unchanged — only this wrapper's own keys are constrained.
export const runbookSpecSchema = z
  .strictObject({
    display: dashboardDisplay.optional(),
    variables: z.array(variable).optional(),
    /** Shared panels referenced from markdown via `ref:` blocks. */
    panels: z.record(z.string(), panel).optional(),
    /** REQUIRED index page (and the whole runbook when there are no pages). */
    markdown: markdownSource,
    pages: z.array(runbookPage).optional(),
    duration: z.string().optional(),
    refreshInterval: z.string().optional(),
  })
  .superRefine((spec, ctx) => {
    addDuplicatePageIssues(spec.pages, ctx, ["pages"]);
  });

/**
 * Strict variant for the write path (`everr apply`): additionally validates
 * each shared panel's plugin spec, mirroring dashboards. The read path stays
 * lenient about *plugin options* so stored runbooks with unknown ones still
 * load (the structural wrapper above is strict on both paths). Query plugin
 * specs are only validated for registered query kinds (currently TestData);
 * unlisted kinds stay loose — never stricter than Perses.
 */
export const runbookSpecSchemaStrict = runbookSpecSchema.superRefine(
  (spec, ctx) => {
    for (const [key, p] of Object.entries(spec.panels ?? {})) {
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

export type RunbookSpec = z.infer<typeof runbookSpecSchema>;

export interface RunbookMetadata {
  name: string;
  /** Perses project namespace. Optional in files; defaults to "default". */
  project?: string;
}

export interface Runbook {
  // Runbook is canonical; "Notebook" stays accepted for back-compat (ADR 0002).
  kind: "Runbook" | "Notebook";
  metadata: RunbookMetadata;
  spec: RunbookSpec;
}
