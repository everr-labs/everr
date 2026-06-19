import * as z from "zod";
import {
  dashboardProjectSchema,
  dashboardSlugSchema,
} from "@/data/dashboards/schema";

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

// A notebook reference: bare `slug` (resolved against the alert's own project)
// or `project/slug`. Each segment must be a valid project/slug name; more than
// one "/" or an empty segment is rejected. Existence is checked at apply time,
// not here.
// Split a `spec.notebook` ref into its parts. Returns null when it has more
// than one "/"; `project` is undefined for a bare slug. Shared by the schema
// (validation) and parseNotebookRef (resolution) so the format lives once.
function notebookRefParts(
  raw: string,
): { project?: string; slug: string } | null {
  const parts = raw.split("/");
  if (parts.length > 2) return null;
  return parts.length === 2
    ? { project: parts[0], slug: parts[1] }
    : { slug: parts[0] };
}

const notebookRefSchema = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    const ref = notebookRefParts(value);
    if (!ref) {
      ctx.addIssue({
        code: "custom",
        message: 'notebook ref must be "slug" or "project/slug"',
      });
      return;
    }
    if (!dashboardSlugSchema.safeParse(ref.slug).success) {
      ctx.addIssue({
        code: "custom",
        message: `invalid notebook slug "${ref.slug}"`,
      });
    }
    if (
      ref.project !== undefined &&
      !dashboardProjectSchema.safeParse(ref.project).success
    ) {
      ctx.addIssue({
        code: "custom",
        message: `invalid notebook project "${ref.project}"`,
      });
    }
  });

/** Resolve a `spec.notebook` ref against the alert's own project. */
export function parseNotebookRef(
  raw: string,
  alertProject: string,
): { project: string; slug: string } {
  // Called after notebookRefSchema validation, so the ref is well-formed.
  const ref = notebookRefParts(raw) ?? { slug: raw };
  return { project: ref.project ?? alertProject, slug: ref.slug };
}

/**
 * Stable identity key for an alert or notebook within a repo: (project, slug).
 * NUL-separated so neither segment can forge a collision. For internal Map
 * keying only.
 */
export function identityKey(project: string, slug: string): string {
  return `${project}\0${slug}`;
}

/** Display form of a notebook ref: bare slug for the default project. */
export function formatNotebookRef(project: string, slug: string): string {
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
        notebook: notebookRefSchema.optional(),
        evaluationInterval: nonEmptyString,
        notificationMessage: notificationMessageSchema,
        query: nonEmptyString,
        instanceLabels: z.array(nonEmptyString).min(1).optional(),
      })
      .strict(),
  })
  .strict();

export type AlertRuleYaml = z.infer<typeof AlertRuleYamlSchema>;
