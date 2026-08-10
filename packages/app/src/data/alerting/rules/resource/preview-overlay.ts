import {
  type AlertingPreviewScope,
  visibleResourcesForPreview,
} from "@/data/alerting/resource/preview-overlay";
import type { AlertingRule } from "@/data/alerting/types";

export function visibleRulesForPreview<
  T extends Pick<
    AlertingRule,
    "previewId" | "repoid" | "name" | "notification_channels" | "spec"
  >,
>(rules: readonly T[], scopes: readonly AlertingPreviewScope[] | null): T[] {
  return visibleResourcesForPreview(rules, scopes);
}
