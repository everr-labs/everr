import { z } from "zod";
import { getPreviewScopes } from "@/data/previews/repoids";
import { createAuthenticatedServerFn } from "@/lib/serverFn";
import { listAllRules } from "../rules/repository";
import { rulesForPreview } from "../rules/resource/preview-overlay";
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
    // A rule the branch deleted keeps firing on live, but those instances
    // belong to live, not to this preview: the branch would not have raised
    // them. The overlay still lists the rule so the deletion is visible.
    const visibleRuleIds = new Set(
      rulesForPreview(rules, scopes)
        .filter((rule) => rule.previewStatus !== "removed")
        .map((rule) => rule.id),
    );
    return alerts.filter((alert) => visibleRuleIds.has(alert.rule));
  });
