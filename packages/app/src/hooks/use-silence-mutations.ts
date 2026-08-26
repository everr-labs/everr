import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  expireAlertSilence,
  silenceAlertRule,
} from "@/data/alerting/triage/mutations";
import { invalidateAlertTriage } from "@/data/alerting/triage/options";

/**
 * The silence writes, for both screens that make them. One place owns what a
 * successful write says and what it refreshes: the triage board, the detail
 * and the Silences page all list silences, and a write from any of them has
 * to reach all three.
 */
export function useSilenceMutations() {
  const queryClient = useQueryClient();
  const refresh = () => invalidateAlertTriage(queryClient);

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

  return { silence, cancelSilence };
}
