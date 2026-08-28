import { RetryError } from "@everr/ui/components/retry-error";
import { Skeleton } from "@everr/ui/components/skeleton";
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
import { RuleInventory } from "@/components/alerts/rule-inventory";
import { SilenceDialog } from "@/components/alerts/silence-dialog";
import { TriageList } from "@/components/alerts/triage-list";
import { ResourceEmptyState } from "@/components/resource-empty-state";
import {
  alertDetailOptions,
  alertTriageOptions,
  ruleStateHistoryOptions,
} from "@/data/alerting/triage/options";
import { useSilenceControls } from "@/hooks/use-silence-controls";
import { useTimeRange } from "@/hooks/use-time-range";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/",
)({
  // The open alert lives in the URL, so the detail survives a reload and can
  // be pasted into an incident channel. The panel is a route, not local UI
  // state, and it is the same URL the rule inventory and the link in a
  // delivered notification both point at.
  validateSearch: ALERT_PANEL_SEARCH,
  // Triage reads live evaluation state, which a preview branch does not
  // overlay: preview rules never evaluate and never notify, so the preview
  // frame would promise a diff that cannot exist. Same reasoning as Silences
  // and Notifications.
  //
  // `fullBleed` hands the page its own scroll: the list and the detail panel
  // scroll independently, so the page itself must not, which is the same
  // contract the rail surfaces (Dashboards, Runbooks) sign.
  staticData: { breadcrumb: "Triage", ...ALERT_PANEL_ROUTE },
  head: () => ({ meta: [{ title: "Everr - Triage" }] }),
  component: AlertingTriagePage,
});

const ASSISTANT_ALERT_PROMPT =
  "/everr-setup-resources Help me build a good first alert rule based on the telemetry we have in production";

function TriageSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

function AlertingTriagePage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const { alert: openPath } = Route.useSearch();
  const { timeRange } = useTimeRange();
  const isNarrow = useAlertPanelIsNarrow();

  const triage = useQuery(alertTriageOptions(timeRange));
  const history = useQuery(ruleStateHistoryOptions(timeRange));
  const detail = useQuery(alertDetailOptions(openPath, timeRange));

  const {
    cancel,
    pending: silencePending,
    seed: silenceTarget,
    openSilence,
    dialogProps,
  } = useSilenceControls();

  const setPaused = useAlertRulePause();

  const setOpen = (path: string | undefined) =>
    navigate({
      // Merge, never replace: `from`/`to` and the active preview live on the
      // dashboard layout's search, and a bare object would drop them.
      search: (prev) => ({ ...prev, alert: path }),
      replace: true,
    });

  // A row is a selection, not a toggle. Clicking the row that is already open
  // leaves it open: the click that lands on the row you are reading is nearly
  // always aim, not a request to close, and losing the panel to it costs a
  // reload of everything in it. Escape and the panel's own close button are
  // the ways out, and both stay one gesture away.
  const openAlert = (path: string) => {
    if (path !== openPath) setOpen(path);
  };

  const closePanel = () => setOpen(undefined);
  useEscapeClosesPanel(
    Boolean(openPath) && !isNarrow && silenceTarget === null,
    closePanel,
  );

  if (triage.isError) {
    return (
      <div className="h-full overflow-auto p-3">
        <RetryError
          title="Could not load alerts"
          message={triage.error.message}
          onRetry={() => void triage.refetch()}
        />
      </div>
    );
  }

  const alerts = triage.data?.alerts ?? [];
  const rules = triage.data?.rules ?? [];
  const silenceAlert = silenceTarget
    ? alerts.find((a) => a.path === silenceTarget.rule)
    : undefined;

  if (!triage.isPending && rules.length === 0) {
    return (
      <div className="h-full overflow-auto p-3">
        <ResourceEmptyState
          title="No alert rules yet"
          description="Paste this into your coding assistant. It writes the YAML, applies it, and the rule shows up here."
          assistantPrompt={ASSISTANT_ALERT_PROMPT}
          docsHref="https://everr.dev/docs/learn/first-alert"
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
      onClose={() => setOpen(undefined)}
      onCancelSilence={cancel}
      onSilence={openSilence}
      silencePending={silencePending}
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
        {/* The lists inside measure themselves against this column rather than
          the window: opening the panel takes width away from them, and a
          viewport breakpoint cannot see that happen. */}
        <div className="@container/list min-h-0 min-w-0 space-y-5 overflow-auto overscroll-y-contain pb-6">
          {triage.isPending ? (
            <TriageSkeleton />
          ) : (
            alerts.length > 0 && (
              <TriageList
                alerts={alerts}
                openPath={openPath ?? null}
                onOpen={openAlert}
                onSilence={(path) =>
                  openSilence({ rule: path, matchers: "", comment: "" })
                }
                onExpireSilence={(path) => {
                  const alert = alerts.find((a) => a.path === path);
                  // No `restore`: the row knows which silence is in force but
                  // not how it was written, and an Undo that guessed the scope
                  // would mute more than the reader muted.
                  if (alert?.silence)
                    cancel({
                      id: alert.silence.id,
                      label: alert.name,
                      restore: null,
                    });
                }}
              />
            )
          )}

          {/* Inventory sits under triage rather than behind its own destination:
            "is there a rule for this at all?" is a question you ask while
            triaging, and a click away is far enough to stop anyone asking it. */}
          {rules.length > 0 && (
            <RuleInventory
              rules={rules}
              history={history.data}
              openPath={openPath ?? null}
              onOpen={openAlert}
            />
          )}
        </div>
      </AlertDetailShell>
      <SilenceDialog
        {...dialogProps}
        instanceCount={silenceAlert?.instances ?? 0}
      />
    </>
  );
}
