import {
  type AlertingPreviewScope,
  visibleResourcesForPreview,
} from "@/data/alerting/resource/preview-overlay";
import type { AlertingSlo } from "@/data/alerting/types";

export function visibleSlosForPreview<T extends AlertingSlo>(
  slos: readonly T[],
  scopes: readonly AlertingPreviewScope[] | null,
): T[] {
  return visibleResourcesForPreview(slos, scopes);
}
