import { RetryError } from "@everr/ui/components/retry-error";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertDetailPanel } from "@/components/alerts/alert-detail-panel";
import {
  ALERT_PANEL_ROUTE,
  ALERT_PANEL_SEARCH,
  AlertDetailShell,
  useAlertPanelIsNarrow,
  useAlertRulePause,
  useEscapeClosesPanel,
} from "@/components/alerts/alert-detail-shell";
import { SilenceDialog } from "@/components/alerts/silence-dialog";
import { SilencesPage } from "@/components/alerts/silences-page";
import {
  alertDetailOptions,
  alertRuleNamesOptions,
  alertSilencesOptions,
} from "@/data/alerting/triage/options";
import { useSilenceControls } from "@/hooks/use-silence-controls";
import { useTimeRange } from "@/hooks/use-time-range";

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
  const navigate = useNavigate({ from: Route.fullPath });
  const { alert: openPath } = Route.useSearch();
  const { timeRange } = useTimeRange();
  const isNarrow = useAlertPanelIsNarrow();

  const silences = useQuery(alertSilencesOptions(timeRange));
  // A silence stores its rule as a path; every other alerting surface calls
  // that rule by name. The map is built by the query rather than in render, so
  // it is rebuilt when the rules change and not on every poll of the list.
  const ruleNames = useQuery(alertRuleNamesOptions());
  const detail = useQuery(alertDetailOptions(openPath, timeRange));

  const { cancel, pending, seed, openSilence, dialogProps } =
    useSilenceControls();
  const setPaused = useAlertRulePause();

  const closePanel = () =>
    navigate({
      // Merge, never replace: `from`/`to` and the active preview live on the
      // dashboard layout's search, and a bare object would drop them.
      search: (prev) => ({ ...prev, alert: undefined }),
      replace: true,
    });

  useEscapeClosesPanel(
    Boolean(openPath) && !isNarrow && seed === null,
    closePanel,
  );

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

  // Built once, in one subtree, so the same panel moves between the column and
  // the sheet rather than being mounted twice.
  const panel = openPath ? (
    <AlertDetailPanel
      path={openPath}
      detail={detail.data ?? null}
      onClose={closePanel}
      onCancelSilence={cancel}
      onSilence={openSilence}
      silencePending={pending}
      pausePending={setPaused.isPending}
      onTogglePaused={(paused) =>
        setPaused.mutate({ data: { path: openPath, paused } })
      }
    />
  ) : null;

  return (
    <>
      <AlertDetailShell
        panel={panel}
        isNarrow={isNarrow}
        onClosePanel={closePanel}
      >
        <div className="min-h-0 min-w-0 overflow-auto overscroll-y-contain pb-6">
          <SilencesPage
            silences={silences.data ?? null}
            ruleNames={ruleNames.data ?? EMPTY_RULE_NAMES}
            pending={pending}
            onNew={() => openSilence({ rule: null, matchers: "", comment: "" })}
            onCancel={cancel}
            onSilenceAgain={openSilence}
          />
        </div>
      </AlertDetailShell>
      <SilenceDialog {...dialogProps} />
    </>
  );
}
