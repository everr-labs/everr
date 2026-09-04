import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  recreateCancelledSilence,
  type SilenceCancelTarget,
  type SilenceDraft,
  type SilenceSeed,
} from "@/data/alerting/silences/commands";
import {
  cancelAlertSilence,
  createAlertSilence,
} from "@/data/alerting/silences/commands.server";
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
    mutationFn: createAlertSilence,
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
    mutationFn: cancelAlertSilence,
    onError: (error: Error) => toast.error(error.message),
  });

  /**
   * Cancel one silence and say which one, in the only sentence that matters:
   * pages resume now. The success message lives here rather than on the
   * mutation because it needs the target the mutation never sees, and because
   * a cancel from the triage board and one from the Silences page must read
   * the same.
   */
  const cancel = (target: SilenceCancelTarget, onFailed?: () => void) =>
    cancelSilence.mutate(
      { data: { id: target.id } },
      {
        // The message is the mutation's; this is for a caller that staked
        // something on the cancel landing and has to take it back. A screen
        // cannot see the failure any other way: the row comes back exactly as
        // it went in.
        onError: () => onFailed?.(),
        onSuccess: async () => {
          // Measured before the refetch, not after: the window Undo recreates
          // is what was left when the reader cancelled, and awaiting the reads
          // first billed their latency to the silence.
          const recreate = recreateCancelledSilence(target, Date.now());
          await refresh();
          toast.success(
            `Silence cancelled · ${target.label} resumes notifying`,
            recreate
              ? {
                  // Bounded on purpose. Sonner keeps a toast that carries an
                  // action until it is dismissed, and an Undo that writes a
                  // silence must not sit on screen indefinitely waiting to be
                  // pressed by something that is no longer the act it belongs
                  // to. Ten seconds is long enough to change your mind and
                  // short enough that the affordance dies with the moment.
                  duration: 10_000,
                  action: {
                    label: "Undo",
                    onClick: () => {
                      silence.mutate({ data: recreate });
                    },
                  },
                }
              : undefined,
          );
        },
      },
    );

  // Neither mutation is returned. `cancelSilence` no longer carries the
  // success path, so a caller reaching for `.mutate` would get a cancel that
  // never refreshes and never says so, and `silence` is written through the
  // dialog. Both stay behind `cancel`, `pending` and `dialogProps`.
  return {
    /** Cancel one silence, named, with an Undo where the caller knows enough
     *  to write it again. Every screen cancels through this. `onFailed` runs
     *  when the write is refused, for a caller holding something on it. */
    cancel,
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
