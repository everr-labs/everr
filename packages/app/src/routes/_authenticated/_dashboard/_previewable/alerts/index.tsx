import { RetryError } from "@everr/ui/components/retry-error";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  ALERT_PANEL_ROUTE,
  ALERT_PANEL_SEARCH,
  AlertDetailShell,
  useAlertDetail,
} from "@/components/alerts/alert-detail-shell";
import { RuleInventory } from "@/components/alerts/rule-inventory";
import { SilenceDialog } from "@/components/alerts/silence-dialog";
import { TriageList } from "@/components/alerts/triage-list";
import { ResourceEmptyState } from "@/components/resource-empty-state";
import {
  cancelSilenceById,
  ruleSilenceSeed,
} from "@/data/alerting/silences/commands";
import {
  alertTriageOptions,
  ruleStateHistoryOptions,
} from "@/data/alerting/triage/options";
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
  const { openPath, openAlert, silence, shellProps } = useAlertDetail();
  const { timeRange } = useTimeRange();
  const triage = useQuery(alertTriageOptions(timeRange));
  const history = useQuery(ruleStateHistoryOptions(timeRange));

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
  const silenceAlert = alerts.find((a) => a.path === silence.seed?.rule);

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

  return (
    <>
      <AlertDetailShell {...shellProps}>
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
                openPath={openPath}
                onOpen={openAlert}
                onSilence={(path) => silence.openSilence(ruleSilenceSeed(path))}
                onExpireSilence={(path) => {
                  const alert = alerts.find((a) => a.path === path);
                  // No recreation: the row knows which silence is in force but
                  // not how it was written, and an Undo that guessed the scope
                  // would mute more than the reader muted.
                  if (alert?.silence)
                    silence.cancel(
                      cancelSilenceById(alert.silence.id, alert.name),
                    );
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
              openPath={openPath}
              onOpen={openAlert}
            />
          )}
        </div>
      </AlertDetailShell>
      <SilenceDialog
        {...silence.dialogProps}
        instanceCount={silenceAlert?.instances ?? 0}
      />
    </>
  );
}
