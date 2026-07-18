import type { z } from "zod";
import type {
  CcAlertSchema,
  CcChannelConfigSchema,
  CcChannelSchema,
  CcInhibitionInputSchema,
  CcInhibitionSchema,
  CcMatcherSchema,
  CcReceiverSchema,
  CcRouteInputSchema,
  CcRouteSchema,
  CcRuleHealthStatusSchema,
  CcRuleRollupSchema,
  CcRuleSpecSchema,
  CcRulesPageSchema,
  CcRuleViewSchema,
  CcSeveritySchema,
  CcSilenceInputSchema,
  CcSilenceSchema,
  CcSloGroupStatusSchema,
  CcSloHealthSchema,
  CcSloInputSchema,
  CcSloSchema,
  CcSloSpecSchema,
  CcSloStatusPayloadSchema,
  CcSloStatusSchema,
  CcSloTestResultSchema,
  CcSloTierSchema,
  CcSloViewSchema,
  CcSubscriptionSchema,
  CcTestResultSchema,
} from "./schema";

export type CcSeverity = z.infer<typeof CcSeveritySchema>;
export type CcRuleHealthStatus = z.infer<typeof CcRuleHealthStatusSchema>;
export type CcMatcher = z.infer<typeof CcMatcherSchema>;
export type CcRuleSpec = z.infer<typeof CcRuleSpecSchema>;
export type CcRuleRollup = z.infer<typeof CcRuleRollupSchema>;
export type CcRuleView = z.infer<typeof CcRuleViewSchema>;
export type CcRulesPage = z.infer<typeof CcRulesPageSchema>;
export type CcAlert = z.infer<typeof CcAlertSchema>;
export type CcChannelConfig = z.infer<typeof CcChannelConfigSchema>;
export type CcChannel = z.infer<typeof CcChannelSchema>;
export type CcReceiver = z.infer<typeof CcReceiverSchema>;
export type CcRoute = z.infer<typeof CcRouteSchema>;
export type CcRouteInput = z.infer<typeof CcRouteInputSchema>;
export type CcInhibitionInput = z.infer<typeof CcInhibitionInputSchema>;
export type CcSilenceInput = z.infer<typeof CcSilenceInputSchema>;
export type CcSilence = z.infer<typeof CcSilenceSchema>;
export type CcInhibition = z.infer<typeof CcInhibitionSchema>;
export type CcSubscription = z.infer<typeof CcSubscriptionSchema>;
export type CcTestResult = z.infer<typeof CcTestResultSchema>;
export type CcSloTier = z.infer<typeof CcSloTierSchema>;
export type CcSloSpec = z.infer<typeof CcSloSpecSchema>;
export type CcSlo = z.infer<typeof CcSloSchema>;
export type CcSloView = z.infer<typeof CcSloViewSchema>;
export type CcSloHealth = z.infer<typeof CcSloHealthSchema>;
export type CcSloGroupStatus = z.infer<typeof CcSloGroupStatusSchema>;
export type CcSloStatusPayload = z.infer<typeof CcSloStatusPayloadSchema>;
export type CcSloStatus = z.infer<typeof CcSloStatusSchema>;
export type CcSloInput = z.infer<typeof CcSloInputSchema>;
export type CcSloTestResult = z.infer<typeof CcSloTestResultSchema>;
