import * as z from "zod";
import { dashboardProjectSchema, dashboardSlugSchema } from "@/data/dashboards/schema";

const nonEmptyString = z.string().min(1);

const alertLabelsSchema = z.record(nonEmptyString, nonEmptyString);
const alertDisplaySchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
  })
  .strict();

const notificationMessageSchema = z
  .object({
    title: nonEmptyString,
    description: z.string().optional(),
  })
  .strict();

// A runbook reference: bare `slug` (resolved against the alert's own project)
// or `project/slug`. Each segment must be a valid project/slug name; more than
// one "/" or an empty segment is rejected. Existence is checked at apply time,
// not here.
// Split a `spec.runbook` ref into its parts. Returns null when it has more
// than one "/"; `project` is undefined for a bare slug. Shared by the schema
// (validation) and parseRunbookRef (resolution) so the format lives once.
function runbookRefParts(raw: string): { project?: string; slug: string } | null {
  const parts = raw.split("/");
  if (parts.length > 2) return null;
  return parts.length === 2 ? { project: parts[0], slug: parts[1] } : { slug: parts[0] };
}

const runbookRefSchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    const ref = runbookRefParts(value);
    if (!ref) {
      ctx.addIssue({
        code: "custom",
        message: 'runbook ref must be "slug" or "project/slug"',
      });
      return;
    }
    if (!dashboardSlugSchema.safeParse(ref.slug).success) {
      ctx.addIssue({
        code: "custom",
        message: `invalid runbook slug "${ref.slug}"`,
      });
    }
    if (ref.project !== undefined && !dashboardProjectSchema.safeParse(ref.project).success) {
      ctx.addIssue({
        code: "custom",
        message: `invalid runbook project "${ref.project}"`,
      });
    }
  });

/** Resolve a `spec.runbook` ref against the alert's own project. */
export function parseRunbookRef(
  raw: string,
  alertProject: string,
): { project: string; slug: string } {
  // Called after runbookRefSchema validation, so the ref is well-formed.
  const ref = runbookRefParts(raw) ?? { slug: raw };
  return { project: ref.project ?? alertProject, slug: ref.slug };
}

/**
 * Stable identity key for an alert or runbook within a repo: (project, slug).
 * NUL-separated so neither segment can forge a collision. For internal Map
 * keying only.
 */
export function identityKey(project: string, slug: string): string {
  return `${project}\0${slug}`;
}

/** Display form of a runbook ref: bare slug for the default project. */
export function formatRunbookRef(project: string, slug: string): string {
  return project === "default" ? slug : `${project}/${slug}`;
}

export const EverrConfigYamlSchema = z
  .object({
    repoid: nonEmptyString,
  })
  .strict();

export const AlertRuleYamlSchema = z
  .object({
    kind: z.literal("AlertRule"),
    metadata: z
      .object({
        name: nonEmptyString,
        project: dashboardProjectSchema.optional(),
        labels: alertLabelsSchema.optional(),
      })
      .strict(),
    spec: z
      .object({
        display: alertDisplaySchema.optional(),
        runbook: runbookRefSchema.optional(),
        // `notebook` is the legacy alias for `runbook` (ADR 0002); accepted in
        // config for back-compat and folded into `runbook` by the transform.
        notebook: runbookRefSchema.optional(),
        evaluationInterval: nonEmptyString,
        notificationMessage: notificationMessageSchema,
        query: nonEmptyString,
        instanceLabels: z.array(nonEmptyString).min(1).optional(),
      })
      .strict()
      .superRefine((spec, ctx) => {
        if (spec.notebook !== undefined && spec.runbook !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'set only one of "runbook" or the legacy "notebook" field, not both',
            path: ["runbook"],
          });
        }
      })
      .transform(({ notebook, ...spec }) => ({
        ...spec,
        runbook: spec.runbook ?? notebook,
      })),
  })
  .strict();

export type AlertRuleYaml = z.infer<typeof AlertRuleYamlSchema>;
