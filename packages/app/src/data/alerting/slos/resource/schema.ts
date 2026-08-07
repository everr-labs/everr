import * as z from "zod";
import { runbookRefSchema } from "@/data/alerting/resource/runbook-ref";
import {
  alertingDisplaySchema,
  alertingNonEmptyStringSchema,
  alertingResourceAnnotationsSchema,
  alertingResourceMetadataSchema,
} from "@/data/alerting/resource/schema";

const MAX_WINDOW_SECS = 366 * 86_400;
const MIN_WINDOW_SECS = 86_400;

// SLO windows use minutes, hours, days, or weeks.
const WINDOW_UNIT_SECONDS = { m: 60, h: 3_600, d: 86_400, w: 604_800 } as const;
const WINDOW_RE = /^(\d+)([mhdw])$/;

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

const timeWindowSchema = windowDurationSchema;

export const SloYamlSchema = z
  .object({
    kind: z.literal("SLO"),
    metadata: alertingResourceMetadataSchema,
    spec: z
      .object({
        display: alertingDisplaySchema.optional(),
        sli: z
          .object({
            // Return numeric `good` and `valid` columns.
            sql: alertingNonEmptyStringSchema.superRefine((sql, ctx) => {
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
        targetPercent: z.number().superRefine((target, ctx) => {
          if (!(target > 0 && target < 100)) {
            ctx.addIssue({
              code: "custom",
              message: `targetPercent must be > 0 and < 100 (got ${target})`,
            });
          }
        }),
        timeWindow: timeWindowSchema,
        minValidEvents: z.number().int().nonnegative().optional(),
        runbook: runbookRefSchema.optional(),
        annotations: alertingResourceAnnotationsSchema.optional(),
      })
      .strict(),
  })
  .strict();

export type SloYaml = z.infer<typeof SloYamlSchema>;
