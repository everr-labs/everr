import { RetryError } from "@everr/ui/components/retry-error";
import { ScrollArea } from "@everr/ui/components/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ALERT_PANEL_ROUTE,
  ALERT_PANEL_SEARCH,
  AlertDetailShell,
  useAlertDetail,
} from "#app/components/alerts/alert-detail-shell.tsx";
import { SilenceDialog } from "#app/components/alerts/silence-dialog.tsx";
import { SilencesPage } from "#app/components/alerts/silences-page.tsx";
import { newSilenceSeed } from "#app/data/alerting/silences/commands.ts";
import { alertSilencesOptions } from "#app/data/alerting/triage/options.ts";
import { useTimeRange } from "#app/hooks/use-time-range.ts";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_previewable/alerts/silences",
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
      <ScrollArea className="h-full" viewportClassName="p-3">
        <RetryError
          title="Could not load silences"
          message={silences.error.message}
          onRetry={() => void silences.refetch()}
        />
      </ScrollArea>
    );
  }

  return (
    <>
      <AlertDetailShell {...shellProps}>
        <ScrollArea className="min-h-0 min-w-0" viewportClassName="overscroll-y-contain pb-6">
          <SilencesPage
            silences={silences.data?.silences ?? null}
            cut={silences.data?.cut ?? null}
            pending={silence.pending}
            onNew={() => silence.openSilence(newSilenceSeed())}
            onCancel={silence.cancel}
            onSilenceAgain={silence.openSilence}
          />
        </ScrollArea>
      </AlertDetailShell>
      <SilenceDialog {...silence.dialogProps} />
    </>
  );
}
