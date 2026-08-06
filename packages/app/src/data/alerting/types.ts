import type { z } from "zod";
import type {
  AlertingAlertSchema,
  AlertingChannelConfigSchema,
  AlertingChannelSchema,
  AlertingInhibitionInputSchema,
  AlertingInhibitionSchema,
  AlertingMatcherSchema,
  AlertingReceiverSchema,
  AlertingRouteInputSchema,
  AlertingRouteSchema,
  AlertingRuleConditionSchema,
  AlertingRuleHealthStatusSchema,
  AlertingRuleInputSchema,
  AlertingRuleSchema,
  AlertingRuleSpecSchema,
  AlertingRulesPageSchema,
  AlertingRuleUpdateSchema,
  AlertingRuleViewSchema,
  AlertingSeveritySchema,
  AlertingSilenceInputSchema,
  AlertingSilenceSchema,
  AlertingSloInputSchema,
  AlertingSloSchema,
  AlertingSloSpecSchema,
  AlertingSloStatusPayloadSchema,
  AlertingSloStatusSchema,
  AlertingSloTierSchema,
  AlertingSloUpdateSchema,
  AlertingSloViewSchema,
} from "./schema";

export type AlertingSeverity = z.infer<typeof AlertingSeveritySchema>;
export type AlertingRuleCondition = z.infer<typeof AlertingRuleConditionSchema>;
export type AlertingRuleHealthStatus = z.infer<
  typeof AlertingRuleHealthStatusSchema
>;
export type AlertingMatcher = z.infer<typeof AlertingMatcherSchema>;
export type AlertingRuleSpec = z.infer<typeof AlertingRuleSpecSchema>;
export type AlertingRule = z.infer<typeof AlertingRuleSchema>;
export type AlertingRuleInput = z.infer<typeof AlertingRuleInputSchema>;
export type AlertingRuleUpdate = z.infer<typeof AlertingRuleUpdateSchema>;
export type AlertingRuleView = z.infer<typeof AlertingRuleViewSchema>;
export type AlertingRulesPage = z.infer<typeof AlertingRulesPageSchema>;
export type AlertingAlert = z.infer<typeof AlertingAlertSchema>;

/** One bounded result-row sample captured from a successful rule evaluation. */
export type AlertingEvaluationSample = {
  fingerprint: string;
  labels: Record<string, string>;
  value: number | null;
};

/** Evaluation history returned to the alert signal chart. */
export type AlertingRuleEvaluationPoint = {
  t: string;
  samples: AlertingEvaluationSample[];
  failed: boolean;
};

export type AlertingRuleEvaluationSeries = {
  points: AlertingRuleEvaluationPoint[];
  samples_truncated: boolean;
};

export type AlertingChannelConfig = z.infer<typeof AlertingChannelConfigSchema>;
export type AlertingChannel = z.infer<typeof AlertingChannelSchema>;
export type AlertingReceiver = z.infer<typeof AlertingReceiverSchema>;
export type AlertingRoute = z.infer<typeof AlertingRouteSchema>;
export type AlertingRouteInput = z.infer<typeof AlertingRouteInputSchema>;
export type AlertingInhibitionInput = z.infer<
  typeof AlertingInhibitionInputSchema
>;
export type AlertingSilenceInput = z.infer<typeof AlertingSilenceInputSchema>;
export type AlertingSilence = z.infer<typeof AlertingSilenceSchema>;
export type AlertingInhibition = z.infer<typeof AlertingInhibitionSchema>;
export type AlertingSloTier = z.infer<typeof AlertingSloTierSchema>;
export type AlertingSloSpec = z.infer<typeof AlertingSloSpecSchema>;
export type AlertingSlo = z.infer<typeof AlertingSloSchema>;
export type AlertingSloView = z.infer<typeof AlertingSloViewSchema>;
export type AlertingSloStatus = z.infer<typeof AlertingSloStatusSchema>;
export type AlertingSloStatusPayload = z.infer<
  typeof AlertingSloStatusPayloadSchema
>;
export type AlertingSloInput = z.infer<typeof AlertingSloInputSchema>;
export type AlertingSloUpdate = z.infer<typeof AlertingSloUpdateSchema>;
