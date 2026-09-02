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
 * What a cancel needs to say, and to take back.
 *
 * Cancelling is the one act here that resumes paging, and it is irreversible
 * in the domain's own terms: a closed window cannot be reopened. So the caller
 * hands over enough to write the silence again, and `Undo` writes a new one
 * over what is left of the old window. That is not a restore and the toast does
 * not claim to be one; it is the same silence, made again, which is the only
 * move the model allows.
 */
export type SilenceCancelTarget = {
  id: string;
  /** What the toast calls the silence: the rule's display name where the
   *  caller knows it, its path otherwise. Never the silence's id, which names
   *  nothing a reader recognizes. */
  label: string;
  /** Everything needed to write the same silence again, and the window this
   *  cancel is about to collapse. `null` where the caller cannot offer it: a
   *  triage row knows which silence is in force but not how it was written, and
   *  an Undo that guessed the scope would mute more than the reader muted. */
  restore:
    | (Omit<SilenceDraft, "durationMinutes"> & {
        /** Pre-cancel `endsAt`. What is left of it is the duration Undo
         *  writes, which is why the draft's own is the one field missing. */
        endsAt: string;
      })
    | null;
};

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
          const { restore } = target;
          // Measured before the refetch, not after: the window Undo restores
          // is what was left when the reader cancelled, and awaiting the reads
          // first billed their latency to the silence.
          //
          // Whole minutes, rounded up, so a window with seconds left still
          // offers an Undo that writes something. A window already spent
          // offers none: there would be nothing to write.
          const left = restore
            ? Math.ceil(
                (new Date(restore.endsAt).getTime() - Date.now()) / 60_000,
              )
            : 0;
          await refresh();
          toast.success(
            `Silence cancelled · ${target.label} resumes notifying`,
            restore && left > 0
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
                      const { endsAt: _closed, ...draft } = restore;
                      silence.mutate({
                        data: { ...draft, durationMinutes: left },
                      });
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
