import * as z from "zod";
import { CcSeveritySchema } from "@/data/cc/schema";
import {
  dashboardProjectSchema,
  dashboardSlugSchema,
} from "@/data/dashboards/schema";
import { isEverrAnnotationKey, RESERVED_ANNOTATION_KEYS } from "./annotations";
import { parseWindow } from "./window";

const nonEmptyString = z.string().min(1);

/**
 * A tenant-unique rule name, mirroring clickety-clack's `validate_name`
 * (api/identity.rs): 1..=128 chars of [A-Za-z0-9_.-] (no `/`, which the
 * composed "project/slug" identity adds). Enforced at parse time so a bad
 * name fails with the file path instead of a raw CC validation error
 * mid-apply. Same contract as the SLO schema's name field.
 */
const ruleNameSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_.-]{1,128}$/,
    "name must be 1-128 chars of [A-Za-z0-9_.-]",
  );

const alertLabelsSchema = z.record(nonEmptyString, nonEmptyString);

// A human-facing name/description overlay on a resource whose canonical
// identity is a technical slug. Shared verbatim by the SLO schema
// (data/slos/schema.ts) for `spec.display` so the grammar lives once.
export const displaySchema = z
  .object({
    name: nonEmptyString.optional(),
    description: nonEmptyString.optional(),
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
// not here. Shared verbatim by the SLO schema (data/slos/schema.ts) for
// `spec.runbook` so the grammar lives once.
// Split a `spec.runbook` ref into its parts. Returns null when it has more
// than one "/"; `project` is undefined for a bare slug. Shared by the schema
// (validation) and parseRunbookRef (resolution) so the format lives once.
function runbookRefParts(
  raw: string,
): { project?: string; slug: string } | null {
  const parts = raw.split("/");
  if (parts.length > 2) return null;
  return parts.length === 2
    ? { project: parts[0], slug: parts[1] }
    : { slug: parts[0] };
}

export const runbookRefSchema = z
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
    if (
      ref.project !== undefined &&
      !dashboardProjectSchema.safeParse(ref.project).success
    ) {
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
export function refIdentityKey(project: string, slug: string): string {
  return `${project}\0${slug}`;
}

/** Display form of a runbook ref: bare slug for the default project. */
export function formatRunbookRef(project: string, slug: string): string {
  return project === "default" ? slug : `${project}/${slug}`;
}

// Reserved keys are the generated-annotation vocabulary (see ./annotations)
// plus every internal `everr.`-prefixed marker.
export function isReservedAnnotationKey(key: string): boolean {
  return isEverrAnnotationKey(key) || RESERVED_ANNOTATION_KEYS.has(key);
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
        name: ruleNameSchema,
        project: dashboardProjectSchema.optional(),
        labels: alertLabelsSchema.optional(),
      })
      .strict(),
    spec: z
      .object({
        display: displaySchema.optional(),
        runbook: runbookRefSchema.optional(),
        // `notebook` is the legacy alias for `runbook` (ADR 0002); accepted in
        // config for back-compat and folded into `runbook` by the transform.
        notebook: runbookRefSchema.optional(),
        evaluationInterval: nonEmptyString,
        // How long the condition must hold before firing. Duration string
        // (<int><s|m|h|d>); "0s" fires on the first matching evaluation.
        for: nonEmptyString.default("0s"),
        // Consecutive empty evaluations required before a firing instance
        // resolves. Raise it to tolerate gaps in the data.
        resolveAfter: z.number().int().min(1).default(1),
        severity: CcSeveritySchema.default("info"),
        notificationMessage: notificationMessageSchema,
        query: nonEmptyString.optional(),
        // `sql` is the clickety-clack-native alias for `query`, accepted for
        // parity with the engine's own RuleSpec vocabulary and folded into
        // `query` by the transform.
        sql: nonEmptyString.optional(),
        instanceLabels: z.array(nonEmptyString).min(1).optional(),
        // `labelColumns` is the clickety-clack-native alias for
        // `instanceLabels`, folded into it by the transform.
        labelColumns: z.array(nonEmptyString).min(1).optional(),
        // Numeric result column carried onto instances/notifications as the
        // alert value; referenced in messages as ${value}.
        valueColumn: nonEmptyString.optional(),
        // Upper bound on how long CC may go without evaluating the rule
        // before flagging it degraded (duration string, engine defaults when
        // unset). Must be >= evaluationInterval when both are set.
        maxInterval: nonEmptyString.optional(),
        // Pass-through annotations merged onto the CC rule alongside the
        // generated ones; reserved keys (see isReservedAnnotationKey) are
        // rejected here so they can never shadow generated sugar.
        annotations: z.record(nonEmptyString, z.string()).optional(),
      })
      .strict()
      .superRefine((spec, ctx) => {
        if (spec.notebook !== undefined && spec.runbook !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'set only one of "runbook" or the legacy "notebook" field, not both',
            path: ["runbook"],
          });
        }
        if (spec.query !== undefined && spec.sql !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'set only one of "query" or its alias "sql", not both',
            path: ["query"],
          });
        } else if (spec.query === undefined && spec.sql === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: '"query" is required (or its alias "sql")',
            path: ["query"],
          });
        }
        if (
          spec.instanceLabels !== undefined &&
          spec.labelColumns !== undefined
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'set only one of "instanceLabels" or its alias "labelColumns", not both',
            path: ["instanceLabels"],
          });
        }
        if (spec.maxInterval !== undefined) {
          let maxIntervalSeconds: number | undefined;
          try {
            maxIntervalSeconds = parseWindow(spec.maxInterval);
          } catch (error) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message:
                error instanceof Error
                  ? error.message
                  : `invalid maxInterval "${spec.maxInterval}"`,
              path: ["maxInterval"],
            });
          }
          if (maxIntervalSeconds !== undefined && spec.evaluationInterval) {
            try {
              const evaluationIntervalSeconds = parseWindow(
                spec.evaluationInterval,
              );
              if (maxIntervalSeconds < evaluationIntervalSeconds) {
                ctx.addIssue({
                  code: z.ZodIssueCode.custom,
                  message: `maxInterval "${spec.maxInterval}" must be >= evaluationInterval "${spec.evaluationInterval}"`,
                  path: ["maxInterval"],
                });
              }
            } catch {
              // A malformed evaluationInterval is reported at apply time
              // (parseEvaluationInterval); nothing to compare against here.
            }
          }
        }
        for (const key of Object.keys(spec.annotations ?? {})) {
          if (isReservedAnnotationKey(key)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `spec.annotations key "${key}" is reserved (generated from other fields)`,
              path: ["annotations", key],
            });
          }
        }
      })
      .transform(({ notebook, sql, labelColumns, ...spec }) => ({
        ...spec,
        runbook: spec.runbook ?? notebook,
        query: (spec.query ?? sql) as string,
        instanceLabels: spec.instanceLabels ?? labelColumns,
      })),
  })
  .strict();

export type AlertRuleYaml = z.infer<typeof AlertRuleYamlSchema>;
