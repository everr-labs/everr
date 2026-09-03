import type { z } from "zod";
import type {
  AlertingChannelConfigSchema,
  AlertingDefaultDestinationInputSchema,
  AlertingMatcherSchema,
  AlertingRuleConditionSchema,
  AlertingRuleHealthStatusSchema,
  AlertingRuleInputSchema,
  AlertingRuleSchema,
  AlertingRuleSpecSchema,
  AlertingRuleUpdateSchema,
  AlertingRuleViewSchema,
  AlertingSeveritySchema,
  AlertingSilenceInputSchema,
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

/** One bounded result-row sample captured from a successful rule evaluation. */
export type AlertingEvaluationSample = {
  fingerprint: string;
  labels: Record<string, string>;
  value: number | null;
};

/** Evaluation history returned to the alert signal chart. */

export type AlertingChannelConfig = z.infer<typeof AlertingChannelConfigSchema>;

/** A channel as the app reads it: the config comes back with its secrets
 *  redacted, so this is never a value that can send anything. */
export type AlertingChannel = {
  id: string;
  tenant: string;
  name: string;
  config: AlertingChannelConfig;
};
export type AlertingSilenceInput = z.infer<typeof AlertingSilenceInputSchema>;

/** The default destination by tier, as channel names. A tier absent from
 *  the record has no channels. The same shape going in and coming out. */
export type AlertingDefaultDestination = z.infer<
  typeof AlertingDefaultDestinationInputSchema
>;
