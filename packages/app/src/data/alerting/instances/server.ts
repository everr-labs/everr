import { z } from "zod";
import { getPreviewScopes } from "@/data/previews/repoids";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { listAllRules } from "../rules/repository";
import { visibleRulesForPreview } from "../rules/resource/preview-overlay";
import { alertingOrganizationId } from "../session";
import { listAlerts } from "./repository";

export const listAlertingAlerts = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ preview: z.string().optional() }).optional())
  .handler(async ({ data, context: { session } }) => {
    const org = alertingOrganizationId(session);
    const preview = data?.preview?.trim() || null;
    const [alerts, rules, scopes] = await Promise.all([
      listAlerts(org),
      listAllRules(org),
      preview === null ? null : getPreviewScopes(org, preview),
    ]);
    const visibleRuleIds = new Set(
      visibleRulesForPreview(rules, scopes).map((rule) => rule.id),
    );
    return alerts.filter((alert) => visibleRuleIds.has(alert.rule));
  });
