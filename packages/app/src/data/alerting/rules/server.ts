import { resolveTimeRange, TimeRangeSchema } from "@everr/ui/lib/time-range";
import { z } from "zod";
import {
  findByResourceName,
  formatResourceName,
} from "@/data/as-code/identity";
import { getPreviewScopes } from "@/data/previews/repoids";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { AlertingError } from "../errors";
import { alertingMutationScope, alertingOrganizationId } from "../session";
import type { AlertingRuleView } from "../types";
import * as rules from "./repository";
import { rulesForPreview } from "./resource/preview-overlay";

export const listAlertingRules = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(z.object({ preview: z.string().optional() }).optional())
  .handler(async ({ data, context: { session } }) => {
    const org = alertingOrganizationId(session);
    const preview = data?.preview?.trim() || null;
    // Live scope is the default: the signal chip wants the organization's
    // real rules, not previews, since it only resolves matcher labels for
    // display. Routing, All Rules, and the alerts page opt into preview
    // scope because their instances are preview-scoped too; a firing
    // preview rule with no matching entry here would render as a bare id.
    if (preview === null) {
      return rules.listAllRules(org, { previewId: null });
    }
    const [definitions, scopes] = await Promise.all([
      rules.listAllRules(org),
      getPreviewScopes(org, preview),
    ]);
    return rulesForPreview(definitions, scopes);
  });

export const getAlertingRule = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ ruleId: z.string() }))
  .handler(({ data: { ruleId }, context: { session } }) =>
    rules.getRule(alertingOrganizationId(session), ruleId),
  );

export const getAlertingRuleByName = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(
    z.object({
      project: z.string(),
      slug: z.string(),
      preview: z.string().optional(),
    }),
  )
  .handler(async ({ data, context: { session } }) => {
    const org = alertingOrganizationId(session);
    const preview = data.preview?.trim() || null;
    let candidates: AlertingRuleView[];
    if (preview === null) {
      candidates = await rules.listAllRules(org, { previewId: null });
    } else {
      const [definitions, scopes] = await Promise.all([
        rules.listAllRules(org),
        getPreviewScopes(org, preview),
      ]);
      candidates = rulesForPreview(definitions, scopes);
    }
    const rule = findByResourceName(candidates, data.project, data.slug);
    if (!rule) {
      throw new AlertingError(
        404,
        "not_found",
        `Rule not found: ${formatResourceName(data.project, data.slug)}`,
      );
    }
    return rule;
  });

export const getAlertingRuleEvaluationSeries = createAuthenticatedServerFn({
  method: "GET",
})
  .inputValidator(
    z.object({
      ruleId: z.string().min(1),
      timeRange: TimeRangeSchema,
      points: z.number().int().min(2).max(500).default(300),
    }),
  )
  .handler(({ data: { ruleId, timeRange, points }, context: { session } }) => {
    const { fromDate, toDate } = resolveTimeRange(timeRange);
    return rules.getRuleEvaluationSeries(
      alertingOrganizationId(session),
      ruleId,
      {
        from: fromDate,
        to: toDate,
        points,
      },
    );
  });

export const pauseAlertingRule = createAuthenticatedServerFn({ method: "POST" })
  .inputValidator(z.object({ ruleId: z.string() }))
  .handler(({ data: { ruleId }, context: { session } }) =>
    rules.pauseRule(alertingMutationScope(session), ruleId),
  );

export const resumeAlertingRule = createAuthenticatedServerFn({
  method: "POST",
})
  .inputValidator(z.object({ ruleId: z.string() }))
  .handler(({ data: { ruleId }, context: { session } }) =>
    rules.resumeRule(alertingMutationScope(session), ruleId),
  );
