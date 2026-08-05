import * as z from "zod";
import {
  displaySchema,
  isReservedAnnotationKey,
  runbookRefSchema,
} from "@/data/alerts/schema";
import { dashboardProjectSchema } from "@/data/dashboards/schema";

const nonEmptyString = z.string().min(1);

/**
 * A tenant-unique SLO name, mirroring clickety-clack's `validate_name`
 * (api/slos.rs): 1..=128 chars of [A-Za-z0-9_.-]. Enforced at parse time so a
 * bad name fails with the file path instead of a CC 422 mid-apply.
 */
const sloNameSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_.-]{1,128}$/,
    "name must be 1-128 chars of [A-Za-z0-9_.-]",
  );

// Upper bound on any window duration, mirroring CC's MAX_WINDOW_SECS
// (api/slos.rs): rolling windows cover at most about a year, and the engine's
// window arithmetic requires the cap.
const MAX_WINDOW_SECS = 366 * 86_400;
const MIN_WINDOW_SECS = 86_400;

// CC's SLO window vocabulary (domain/slo.rs parse_window_secs): m/h/d/w only —
// note no seconds, unlike AlertRule durations, and no calendar units (M/Q/Y).
const WINDOW_UNIT_SECONDS = { m: 60, h: 3_600, d: 86_400, w: 604_800 } as const;
const WINDOW_RE = /^(\d+)([mhdw])$/;

/**
 * Parse an SLO window shorthand ("24h", "30d", "1w") to seconds, mirroring
 * clickety-clack's `parse_window_secs` plus its 1-day..366-day bounds. Throws
 * with a message naming the value.
 */
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

/**
 * `spec.timeWindow`: the budget window. The shorthand string ("30d") is the
 * canonical as-code form — v1 is rolling-only, so the window IS its duration.
 * The object form `{ duration, isRolling }` is also accepted for symmetry with
 * CC's own wire shape; `isRolling: false` (calendar windows) is rejected like
 * CC does. Both forms normalize to the duration string.
 */
const timeWindowSchema = z
  .union([
    windowDurationSchema,
    z
      .object({
        duration: windowDurationSchema,
        isRolling: z.boolean().default(true),
      })
      .strict()
      .superRefine((tw, ctx) => {
        if (!tw.isRolling) {
          ctx.addIssue({
            code: "custom",
            message:
              "calendar-aligned windows are not supported (set isRolling: true or use the plain duration string)",
            path: ["isRolling"],
          });
        }
      }),
  ])
  .transform((tw) => (typeof tw === "string" ? tw : tw.duration));

/**
 * `kind: SLO` as-code document. Mirrors clickety-clack's SloSpec
 * (domain/slo.rs) in as-code camelCase, with CC's cheap static validation
 * (api/slos.rs validate_slo_spec) applied at parse time so failures carry the
 * file path and a precise message. The SQL itself is validated by CC's
 * dry-run test endpoint during apply.
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
            // A single read-only SELECT returning numeric `good` and `valid`
            // columns; the engine injects the window as ClickHouse parameters.
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
        // The objective, exclusive on both ends like CC's validation.
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
        // Pass-through annotations merged onto the CC SLO alongside the
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
