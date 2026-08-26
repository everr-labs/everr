import { RetryError } from "@everr/ui/components/retry-error";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  SilenceDialog,
  type SilenceSeed,
} from "@/components/alerts/silence-dialog";
import { SilencesPage } from "@/components/alerts/silences-page";
import { alertSilencesOptions } from "@/data/alerting/triage/options";
import { useSilenceMutations } from "@/hooks/use-silence-mutations";
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
  const { timeRange } = useTimeRange();
  const silences = useQuery(alertSilencesOptions(timeRange));
  const { silence, cancelSilence } = useSilenceMutations();
  const [seed, setSeed] = useState<SilenceSeed | null>(null);

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
        silences={silences.data ?? null}
        pending={silence.isPending || cancelSilence.isPending}
        onNew={() => setSeed({ rule: null, matchers: "", comment: "" })}
        onCancel={(id) => cancelSilence.mutate({ data: { id } })}
        onSilenceAgain={setSeed}
      />
      <SilenceDialog
        seed={seed}
        pending={silence.isPending}
        onClose={() => setSeed(null)}
        onConfirm={(draft) =>
          silence.mutate({ data: draft }, { onSuccess: () => setSeed(null) })
        }
      />
    </>
  );
}
