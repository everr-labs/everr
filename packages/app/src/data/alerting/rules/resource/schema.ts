import * as z from "zod";
import { runbookRefSchema } from "@/data/alerting/resource/runbook-ref";
import {
  alertingChannelNamesSchema,
  alertingDisplaySchema,
  alertingNonEmptyStringSchema,
  alertingResourceAnnotationsSchema,
  alertingResourceMetadataSchema,
} from "@/data/alerting/resource/schema";
import {
  AlertingRuleConditionSchema,
  AlertingSeveritySchema,
} from "@/data/alerting/schema";
import { parseWindow } from "./window";

const notificationMessageSchema = z
  .object({
    title: alertingNonEmptyStringSchema,
    description: z.string().optional(),
  })
  .strict();

const notificationDestinationSchema = z
  .object({
    channels: alertingChannelNamesSchema(1),
  })
  .strict();

export const AlertRuleYamlSchema = z
  .object({
    kind: z.literal("AlertRule"),
    metadata: alertingResourceMetadataSchema,
    spec: z
      .object({
        display: alertingDisplaySchema.optional(),
        runbook: runbookRefSchema.optional(),
        evaluationInterval: alertingNonEmptyStringSchema,
        // The rule fires after the condition holds for this duration.
        for: alertingNonEmptyStringSchema.default("0s"),
        resolveAfter: z.number().int().min(1).default(1),
        severity: AlertingSeveritySchema.default("info"),
        // An explicit destination bypasses route matching.
        notification: notificationDestinationSchema.optional(),
        notificationMessage: notificationMessageSchema,
        query: alertingNonEmptyStringSchema,
        instanceLabels: z.array(alertingNonEmptyStringSchema).min(1).optional(),
        // Apply the condition to the numeric `value` in each result row.
        condition: AlertingRuleConditionSchema,
        // The rule is degraded when its last evaluation is older than this value.
        maxInterval: alertingNonEmptyStringSchema.optional(),
        annotations: alertingResourceAnnotationsSchema.optional(),
      })
      .strict()
      .superRefine((spec, ctx) => {
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
              // Apply reports an invalid evaluationInterval.
            }
          }
        }
      }),
  })
  .strict();

export type AlertRuleYaml = z.infer<typeof AlertRuleYamlSchema>;
