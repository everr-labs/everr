import { createFileRoute } from "@tanstack/react-router";
import { SilencesPage } from "@/components/alerts/prototype-silences/page";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/silences",
)({
  // Silences are live operational state, not an as-code resource a preview
  // branch overlays, so the preview banner would be misleading here.
  staticData: { breadcrumb: "Silences", hidePreviewFrame: true },
  head: () => ({ meta: [{ title: "Everr - Alert silences" }] }),
  component: SilencesPage,
});
