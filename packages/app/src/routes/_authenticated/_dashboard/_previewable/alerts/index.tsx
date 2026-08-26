import { RetryError } from "@everr/ui/components/retry-error";
import { Sheet, SheetContent, SheetTitle } from "@everr/ui/components/sheet";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useMediaQuery } from "@everr/ui/hooks/use-media-query";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { AlertDetailPanel } from "@/components/alerts/alert-detail-panel";
import { RuleInventory } from "@/components/alerts/rule-inventory";
import { SilenceDialog } from "@/components/alerts/silence-dialog";
import { TriageList } from "@/components/alerts/triage-list";
import { ResourceEmptyState } from "@/components/resource-empty-state";
import {
  expireAlertSilence,
  setAlertRulePaused,
  silenceAlertRule,
} from "@/data/alerting/triage/mutations";
import {
  alertDetailOptions,
  alertTriageOptions,
  invalidateAlertTriage,
  ruleStateHistoryOptions,
} from "@/data/alerting/triage/options";
import { useTimeRange } from "@/hooks/use-time-range";

type SilenceTarget = {
  path: string;
  seed?: { matchers: string; comment: string };
};

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/",
)({
  // The open alert lives in the URL, so the detail survives a reload and can
  // be pasted into an incident channel. The panel is a route, not local UI
  // state, and it is the same URL the rule inventory and the link in a
  // delivered notification both point at.
  validateSearch: z.object({ alert: z.string().optional() }),
  // Triage reads live evaluation state, which a preview branch does not
  // overlay: preview rules never evaluate and never notify, so the preview
  // frame would promise a diff that cannot exist. Same reasoning as Silences
  // and Notifications.
  //
  // `fullBleed` hands the page its own scroll: the list and the detail panel
  // scroll independently, so the page itself must not, which is the same
  // contract the rail surfaces (Dashboards, Runbooks) sign.
  staticData: { breadcrumb: "Triage", hidePreviewFrame: true, fullBleed: true },
  head: () => ({ meta: [{ title: "Everr - Triage" }] }),
  component: AlertingTriagePage,
});

const ASSISTANT_ALERT_PROMPT =
  "/everr-setup-resources Help me build a good first alert rule based on the telemetry we have in production";

// Under this there is no width to split: a detail column narrow enough to fit
// would leave the list unreadable, so the same panel arrives as a sheet
// instead. The Explore grids put their inspector column behind `lg` too.
const NARROW_QUERY = "(max-width: 1023px)";

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
  const queryClient = useQueryClient();
  const { alert: openPath } = Route.useSearch();
  const { timeRange } = useTimeRange();
  // Not just the path: the dialog is also opened from a closed silence in the
  // detail panel, which hands it the matchers and comment to start from.
  const [silenceTarget, setSilenceTarget] = useState<SilenceTarget | null>(
    null,
  );
  const isNarrow = useMediaQuery(NARROW_QUERY);

  const triage = useQuery(alertTriageOptions(timeRange));
  const history = useQuery(ruleStateHistoryOptions(timeRange));
  const detail = useQuery(alertDetailOptions(openPath, timeRange));

  const refresh = () => invalidateAlertTriage(queryClient);

  const silence = useMutation({
    mutationFn: silenceAlertRule,
    onSuccess: async (_result, variables) => {
      await refresh();
      toast.success(`Silenced ${variables.data.path}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setPaused = useMutation({
    mutationFn: setAlertRulePaused,
    onSuccess: async (result, variables) => {
      await refresh();
      toast.success(
        `${result.paused ? "Paused" : "Resumed"} ${variables.data.path}`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // "Cancel", not "expire": a silence expires when its window runs out, and
  // this closes the window early. The two are separate states in the list
  // below, so the button that produces one must not be named after the other.
  const cancelSilence = useMutation({
    mutationFn: expireAlertSilence,
    onSuccess: async () => {
      await refresh();
      toast.success("Silence cancelled");
    },
    onError: (error: Error) => toast.error(error.message),
  });

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

  // The column is not a modal, so nothing dismisses it for us, and Escape is
  // what a reader who just opened a row reaches for. The sheet answers it on a
  // narrow window, so the column has to answer it on a wide one. The silence
  // dialog keeps the key while it is up: it is the innermost thing on screen.
  const silenceOpen = silenceTarget !== null;
  useEffect(() => {
    if (!openPath || isNarrow || silenceOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      navigate({
        search: (prev) => ({ ...prev, alert: undefined }),
        replace: true,
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openPath, isNarrow, silenceOpen, navigate]);

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
    ? alerts.find((a) => a.path === silenceTarget.path)
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
      onCancelSilence={(id) => cancelSilence.mutate({ data: { id } })}
      onSilence={(seed) => setSilenceTarget({ path: openPath, seed })}
      silencePending={silence.isPending || cancelSilence.isPending}
      pausePending={setPaused.isPending}
      onTogglePaused={(paused) =>
        setPaused.mutate({ data: { path: openPath, paused } })
      }
    />
  ) : null;

  return (
    <div
      className={cn(
        // Two panes that scroll independently, so the detail keeps its header
        // in place while you read down a rule and the list keeps the row you
        // clicked exactly where you left it.
        "grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)]",
        panel &&
          !isNarrow &&
          "lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_27rem] 2xl:grid-cols-[minmax(0,1fr)_31rem]",
      )}
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
              onSilence={(path) => setSilenceTarget({ path })}
              onExpireSilence={(path) => {
                const id = alerts.find((a) => a.path === path)?.silence?.id;
                if (id) cancelSilence.mutate({ data: { id } });
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

      {isNarrow ? (
        <Sheet
          open={Boolean(openPath)}
          onOpenChange={(next) => {
            if (!next) setOpen(undefined);
          }}
        >
          {/* The panel draws its own close button, in the same place at both
              widths, so the sheet's would be a second one beside it. */}
          <SheetContent
            showCloseButton={false}
            className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[30rem]"
          >
            <SheetTitle className="sr-only">Alert detail</SheetTitle>
            {panel}
          </SheetContent>
        </Sheet>
      ) : (
        panel && (
          // The column arrives from the edge it will occupy, once, at the
          // speed the app's other overlays open. Switching rules keeps the
          // same column, so it does not replay.
          <aside
            aria-label="Alert detail"
            className="animate-in fade-in slide-in-from-right-4 min-h-0 min-w-0 border-l duration-200 motion-reduce:animate-none"
          >
            {panel}
          </aside>
        )
      )}

      {/* Remounted per opening, so the fields start from whatever seeded this
          one instead of holding the last opening's text. A `key` says that in
          one line; syncing props into state with an effect would be the same
          fact, spelled as a bug. */}
      <SilenceDialog
        key={silenceTarget ? JSON.stringify(silenceTarget) : "closed"}
        path={silenceTarget?.path ?? null}
        seed={silenceTarget?.seed}
        instanceCount={silenceAlert?.instances ?? 0}
        pending={silence.isPending}
        onClose={() => setSilenceTarget(null)}
        onConfirm={(draft) => {
          silence.mutate(
            {
              data: {
                path: draft.path,
                durationMinutes: draft.minutes,
                matchers: draft.matchers,
                comment: draft.comment,
              },
            },
            { onSuccess: () => setSilenceTarget(null) },
          );
        }}
      />
    </div>
  );
}
