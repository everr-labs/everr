import * as z from "zod";
import {
  displaySchema,
  isReservedAnnotationKey,
  runbookRefSchema,
} from "@/data/alerting/resources/rules/schema";
import { dashboardProjectSchema } from "@/data/dashboards/schema";

const nonEmptyString = z.string().min(1);

/** A tenant-unique SLO name accepted by storage and as-code apply. */
const sloNameSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_.-]{1,128}$/,
    "name must be 1-128 chars of [A-Za-z0-9_.-]",
  );

// Rolling budget windows cover at most about one year.
const MAX_WINDOW_SECS = 366 * 86_400;
const MIN_WINDOW_SECS = 86_400;

// The SLO window vocabulary is m/h/d/w only:
// note no seconds, unlike AlertRule durations, and no calendar units (M/Q/Y).
const WINDOW_UNIT_SECONDS = { m: 60, h: 3_600, d: 86_400, w: 604_800 } as const;
const WINDOW_RE = /^(\d+)([mhdw])$/;

/** Parse a 1-day to 366-day SLO window shorthand into seconds. */
export function parseSloWindowSeconds(value: string): number {
  const match = WINDOW_RE.exec(value.trim());
  if (!match) {
    throw new Error(
      `invalid window duration "${value}": expected <integer><m|h|d|w>, e.g. "30d"`,
    );
  }
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new Error(`invalid window duration "${value}": must be positive`);
  }
  const seconds =
    amount * WINDOW_UNIT_SECONDS[match[2] as keyof typeof WINDOW_UNIT_SECONDS];
  if (seconds < MIN_WINDOW_SECS) {
    throw new Error(`window duration "${value}" is below the minimum of 1 day`);
  }
  if (seconds > MAX_WINDOW_SECS) {
    throw new Error(
      `window duration "${value}" exceeds the maximum of 366 days`,
    );
  }
  return seconds;
}

/** A window shorthand string validated (units, positivity, 1d..366d bounds) at parse time. */
const windowDurationSchema = z.string().superRefine((value, ctx) => {
  try {
    parseSloWindowSeconds(value);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message: error instanceof Error ? error.message : "invalid window",
    });
  }
});

/** The rolling error-budget window shorthand, for example "30d". */
const timeWindowSchema = windowDurationSchema;

/**
 * `kind: SLO` as-code document. SQL is validated by a dry-run evaluation.
 *
 * ```yaml
 * kind: SLO
 * metadata:
 *   name: checkout-availability
 * spec:
 *   sli:
 *     sql: >-
 *       SELECT countIf(ok) AS good, count() AS valid FROM checkouts
 *       WHERE ts >= {window_start:DateTime} AND ts < {window_end:DateTime}
 *   targetPercent: 99.9
 *   timeWindow: 30d
 * ```
 */
export const SloYamlSchema = z
  .object({
    kind: z.literal("SLO"),
    metadata: z
      .object({
        name: sloNameSchema,
        project: dashboardProjectSchema.optional(),
        labels: z.record(nonEmptyString, nonEmptyString).optional(),
      })
      .strict(),
    spec: z
      .object({
        // A human-facing name/description overlay: the SLO's canonical name
        // stays the technical slug, but display.name (when set) drives the
        // burn notification summary too (see toSloInput in ./mapping).
        display: displaySchema.optional(),
        sli: z
          .object({
            // A read-only SELECT returning numeric `good` and `valid` columns.
            sql: nonEmptyString.superRefine((sql, ctx) => {
              if (
                !sql.includes("{window_start:") ||
                !sql.includes("{window_end:")
              ) {
                ctx.addIssue({
                  code: "custom",
                  message:
                    "sli.sql must reference both {window_start:DateTime} and {window_end:DateTime}",
                });
              }
            }),
          })
          .strict(),
        // The objective is exclusive on both ends.
        targetPercent: z.number().superRefine((target, ctx) => {
          if (!(target > 0 && target < 100)) {
            ctx.addIssue({
              code: "custom",
              message: `targetPercent must be > 0 and < 100 (got ${target})`,
            });
          }
        }),
        timeWindow: timeWindowSchema,
        // Optional low-traffic floor on each tier's long window; omit = off.
        minValidEvents: z.number().int().nonnegative().optional(),
        // A linked runbook: bare `slug` (resolved against this SLO's own
        // project) or `project/slug`. Same grammar AlertRule's spec.runbook
        // uses, imported rather than duplicated.
        runbook: runbookRefSchema.optional(),
        // Pass-through annotations merged onto the stored SLO alongside the
        // generated ownership keys; `everr.`-prefixed keys are reserved for
        // those and rejected here so they can never be shadowed.
        annotations: z.record(nonEmptyString, z.string()).optional(),
      })
      .strict()
      .superRefine((spec, ctx) => {
        for (const key of Object.keys(spec.annotations ?? {})) {
          if (isReservedAnnotationKey(key)) {
            ctx.addIssue({
              code: "custom",
              message: `spec.annotations key "${key}" is reserved (generated from other fields)`,
              path: ["annotations", key],
            });
          }
        }
      }),
  })
  .strict();

export type SloYaml = z.infer<typeof SloYamlSchema>;
