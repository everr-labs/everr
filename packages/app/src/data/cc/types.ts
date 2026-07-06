import type { z } from "zod";
import type {
  CcAlertSchema,
  CcEventSchema,
  CcInhibitionSchema,
  CcMatcherSchema,
  CcReceiverSchema,
  CcRouteSchema,
  CcRuleRollupSchema,
  CcRuleSpecSchema,
  CcRulesPageSchema,
  CcRuleViewSchema,
  CcSilenceSchema,
  CcSubscriptionSchema,
  CcTestResultSchema,
} from "./schema";

export type CcMatcher = z.infer<typeof CcMatcherSchema>;
export type CcRuleSpec = z.infer<typeof CcRuleSpecSchema>;
export type CcRuleRollup = z.infer<typeof CcRuleRollupSchema>;
export type CcRuleView = z.infer<typeof CcRuleViewSchema>;
export type CcRulesPage = z.infer<typeof CcRulesPageSchema>;
export type CcAlert = z.infer<typeof CcAlertSchema>;
export type CcReceiver = z.infer<typeof CcReceiverSchema>;
export type CcRoute = z.infer<typeof CcRouteSchema>;
export type CcSilence = z.infer<typeof CcSilenceSchema>;
export type CcInhibition = z.infer<typeof CcInhibitionSchema>;
export type CcSubscription = z.infer<typeof CcSubscriptionSchema>;
export type CcEvent = z.infer<typeof CcEventSchema>;
export type CcTestResult = z.infer<typeof CcTestResultSchema>;
