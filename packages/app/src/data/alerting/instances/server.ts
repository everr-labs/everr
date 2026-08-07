import { z } from "zod";
import { getPreviewScopes } from "@/data/previews/repoids";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { listAllRules } from "../rules/repository";
import { visibleRulesForPreview } from "../rules/resource/preview-overlay";
import { alertingOrganizationId } from "../session";
import { listSlos } from "../slos/repository";
import { visibleSlosForPreview } from "../slos/resource/preview-overlay";
import { listAlerts } from "./repository";

export const listAlertingAlerts = createAuthenticatedServerFn({ method: "GET" })
  .inputValidator(z.object({ preview: z.string().optional() }).optional())
  .handler(async ({ data, context: { session } }) => {
    const org = alertingOrganizationId(session);
    const preview = data?.preview?.trim() || null;
    const [alerts, rules, slos, scopes] = await Promise.all([
      listAlerts(org),
      listAllRules(org),
      listSlos(org),
      preview === null ? null : getPreviewScopes(org, preview),
    ]);
    const visibleRuleIds = new Set(
      visibleRulesForPreview(rules, scopes).map((rule) => rule.id),
    );
    const visibleSloIds = new Set(
      visibleSlosForPreview(slos, scopes).map((slo) => slo.id),
    );
    return alerts.filter((alert) =>
      alert.slo !== undefined
        ? visibleSloIds.has(alert.slo)
        : visibleRuleIds.has(alert.rule),
    );
  });
