import { RetryError } from "@everr/ui/components/retry-error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { SilenceDialog } from "@/components/alerts/silence-dialog";
import {
  type SilenceAgainSeed,
  SilencesPage,
} from "@/components/alerts/silences-page";
import {
  expireAlertSilence,
  silenceAlertRule,
} from "@/data/alerting/triage/mutations";
import {
  alertSilencesOptions,
  invalidateAlertTriage,
} from "@/data/alerting/triage/options";
import { useTimeRange } from "@/hooks/use-time-range";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_previewable/alerts/silences",
)({
  // Silences are live operational state, not an as-code resource a preview
  // branch overlays, so the preview banner would be misleading here.
  staticData: { breadcrumb: "Silences", hidePreviewFrame: true },
  head: () => ({ meta: [{ title: "Everr - Alert silences" }] }),
  component: AlertingSilencesPage,
});

function AlertingSilencesPage() {
  const queryClient = useQueryClient();
  const { timeRange } = useTimeRange();
  const silences = useQuery(alertSilencesOptions(timeRange));
  // Which silence the dialog starts from: "New silence" starts from nothing,
  // "Silence again" from the closed row it was pressed on.
  const [target, setTarget] = useState<SilenceAgainSeed | null>(null);

  const refresh = () => invalidateAlertTriage(queryClient);

  const silence = useMutation({
    mutationFn: silenceAlertRule,
    onSuccess: async (_result, variables) => {
      await refresh();
      toast.success(`Silenced ${variables.data.path}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const cancelSilence = useMutation({
    mutationFn: expireAlertSilence,
    onSuccess: async () => {
      await refresh();
      toast.success("Silence cancelled");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (silences.isError) {
    return (
      <RetryError
        title="Could not load silences"
        message={silences.error.message}
        onRetry={() => void silences.refetch()}
      />
    );
  }

  return (
    <>
      <SilencesPage
        silences={silences.data?.silences ?? null}
        pending={silence.isPending || cancelSilence.isPending}
        onNew={() =>
          setTarget({ rule: null, seed: { matchers: "", comment: "" } })
        }
        onCancel={(id) => cancelSilence.mutate({ data: { id } })}
        onSilenceAgain={setTarget}
      />
      {/* Remounted per opening (see the `key`) so the fields start from
          whatever seeded this one rather than the last opening's text. */}
      <SilenceDialog
        key={target ? JSON.stringify(target) : "closed"}
        open={target !== null}
        path={target?.rule ?? null}
        rules={silences.data?.rules ?? []}
        seed={target?.seed}
        instanceCount={0}
        pending={silence.isPending}
        onClose={() => setTarget(null)}
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
            { onSuccess: () => setTarget(null) },
          );
        }}
      />
    </>
  );
}
