import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import type {
  SilenceDraft,
  SilenceSeed,
} from "@/components/alerts/silence-dialog";
import {
  expireAlertSilence,
  silenceAlertRule,
} from "@/data/alerting/triage/mutations";
import { invalidateAlertTriage } from "@/data/alerting/triage/options";

/**
 * Everything a screen needs to make and unmake silences: the two writes, and
 * the dialog they are made through. One place owns what a successful write
 * says, what it refreshes, and when the dialog goes away: the triage board,
 * the detail and the Silences page all list silences, and a write from any of
 * them has to reach all three and read the same on the way.
 */
export function useSilenceControls() {
  const queryClient = useQueryClient();
  const refresh = () => invalidateAlertTriage(queryClient);
  // What the dialog is open on; `null` while it is closed.
  const [seed, setSeed] = useState<SilenceSeed | null>(null);

  const silence = useMutation({
    mutationFn: silenceAlertRule,
    onSuccess: async (_result, variables) => {
      await refresh();
      toast.success(`Silenced ${variables.data.path}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // "Cancel", not "expire": a silence expires when its window runs out, and
  // this closes the window early. The two are separate states in every list
  // of silences, so the button that produces one must not be named after
  // the other.
  const cancelSilence = useMutation({
    mutationFn: expireAlertSilence,
    onSuccess: async () => {
      await refresh();
      toast.success("Silence cancelled");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return {
    silence,
    cancelSilence,
    /** A write is in flight; every silence control on the screen goes inert. */
    pending: silence.isPending || cancelSilence.isPending,
    seed,
    /** Opens the dialog on a seed. Every "silence" button on every screen. */
    openSilence: setSeed,
    /** What the dialog wants, so no screen writes the close policy itself: it
     *  stays up and inert until the write lands, and a failed one keeps the
     *  draft rather than making the reader type it again. */
    dialogProps: {
      seed,
      pending: silence.isPending,
      onClose: () => setSeed(null),
      onConfirm: (draft: SilenceDraft) =>
        silence.mutate({ data: draft }, { onSuccess: () => setSeed(null) }),
    },
  };
}
