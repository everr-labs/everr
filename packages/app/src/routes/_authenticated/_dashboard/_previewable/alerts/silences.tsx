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
import {
  alertRuleNamesOptions,
  alertSilencesOptions,
} from "@/data/alerting/triage/options";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/silences",
)({
  validateSearch: ALERT_PANEL_SEARCH,
  staticData: { breadcrumb: "Silences", ...ALERT_PANEL_ROUTE },
  head: () => ({ meta: [{ title: "Everr - Alert silences" }] }),
  component: AlertingSilencesPage,
});

const EMPTY_RULE_NAMES = new Map<string, string>();

function AlertingSilencesPage() {
  const { silence, timeRange, shellProps } = useAlertDetail();
  const silences = useQuery(alertSilencesOptions(timeRange));
  // A silence stores its rule as a path; every other alerting surface calls
  // that rule by name. The map is built by the query rather than in render, so
  // it is rebuilt when the rules change and not on every poll of the list.
  const ruleNames = useQuery(alertRuleNamesOptions());

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
            silences={silences.data ?? null}
            ruleNames={ruleNames.data ?? EMPTY_RULE_NAMES}
            pending={silence.pending}
            onNew={() =>
              silence.openSilence({ rule: null, matchers: "", comment: "" })
            }
            onCancel={silence.cancel}
            onSilenceAgain={silence.openSilence}
          />
        </div>
      </AlertDetailShell>
      <SilenceDialog {...silence.dialogProps} />
    </>
  );
}
