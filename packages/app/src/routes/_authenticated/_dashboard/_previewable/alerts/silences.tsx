import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";
import { PageHeader } from "@/components/page-header";
import { silenceQueries } from "@/data/alerting/silences/queries";
import {
  SilenceCreateDrawer,
  type SilenceDrawerHandle,
  SilencesPanel,
} from "./-components/silences/panel";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/silences",
)({
  staticData: { breadcrumb: "Silences" },
  head: () => ({ meta: [{ title: "Everr - Alert silences" }] }),
  loader: ({ context: { queryClient } }) =>
    queryClient.prefetchQuery(silenceQueries.list()),
  component: AlertingSilencesPage,
});

function AlertingSilencesPage() {
  const silenceDrawer = useRef<SilenceDrawerHandle>(null);
  return (
    <div className="space-y-3">
      <PageHeader
        title="Silences"
        lede="Silenced alerts stay visible but are not delivered."
      />
      <SilencesPanel onNewSilence={() => silenceDrawer.current?.openWith([])} />
      <SilenceCreateDrawer ref={silenceDrawer} />
    </div>
  );
}
