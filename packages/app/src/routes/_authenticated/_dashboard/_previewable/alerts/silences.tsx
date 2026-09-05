import { RetryError } from "@everr/ui/components/retry-error";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ALERT_PANEL_ROUTE,
  ALERT_PANEL_SEARCH,
  AlertDetailShell,
  useAlertDetail,
} from "@/components/alerts/alert-detail-shell";
import { SilenceDialog } from "@/components/alerts/silence-dialog";
import { SilencesPage } from "@/components/alerts/silences-page";
import { newSilenceSeed } from "@/data/alerting/silences/commands";
import { alertSilencesOptions } from "@/data/alerting/triage/options";
import { useTimeRange } from "@/hooks/use-time-range";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/silences",
)({
  validateSearch: ALERT_PANEL_SEARCH,
  staticData: { breadcrumb: "Silences", ...ALERT_PANEL_ROUTE },
  head: () => ({ meta: [{ title: "Everr - Alert silences" }] }),
  component: AlertingSilencesPage,
});

function AlertingSilencesPage() {
  const { silence, shellProps } = useAlertDetail();
  const { timeRange } = useTimeRange();
  // Each record arrives with its rule's display name already resolved: the
  // read had the organization's rules in hand to resolve the stored id at all,
  // so the page does not fetch that list a second time to turn a path into a
  // name.
  const silences = useQuery(alertSilencesOptions(timeRange));

  if (silences.isError) {
    return (
      <div className="h-full overflow-auto p-3">
        <RetryError
          title="Could not load silences"
          message={silences.error.message}
          onRetry={() => void silences.refetch()}
        />
      </div>
    );
  }

  return (
    <>
      <AlertDetailShell {...shellProps}>
        <div className="min-h-0 min-w-0 overflow-auto overscroll-y-contain pb-6">
          <SilencesPage
            silences={silences.data?.silences ?? null}
            cut={silences.data?.cut ?? null}
            pending={silence.pending}
            onNew={() => silence.openSilence(newSilenceSeed())}
            onCancel={silence.cancel}
            onSilenceAgain={silence.openSilence}
          />
        </div>
      </AlertDetailShell>
      <SilenceDialog {...silence.dialogProps} />
    </>
  );
}
