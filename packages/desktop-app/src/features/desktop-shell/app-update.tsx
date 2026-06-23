import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpCircle } from "lucide-react";
import { toast } from "sonner";
import {
  invokeCommand,
  toErrorMessageText,
  UPDATE_AVAILABLE_EVENT,
} from "../../lib/tauri";
import { useInvalidateOnTauriEvent } from "../../lib/tauri-events";

type PendingUpdate = {
  version: string;
};

const pendingUpdateQueryKey = ["desktop-app", "pending-update"] as const;

function getPendingUpdate() {
  return invokeCommand<PendingUpdate | null>("get_pending_update");
}

function installPendingUpdate() {
  return invokeCommand<void>("install_pending_update");
}

function usePendingUpdateQuery() {
  useInvalidateOnTauriEvent(UPDATE_AVAILABLE_EVENT, (queryClient) => {
    void queryClient.invalidateQueries({ queryKey: pendingUpdateQueryKey });
  });

  return useQuery({
    queryKey: pendingUpdateQueryKey,
    queryFn: getPendingUpdate,
  });
}

function useInstallUpdateMutation() {
  // No onSuccess: a successful install restarts the app process (the backend
  // calls request_restart), so there is no UI state left to update.
  return useMutation({
    mutationFn: installPendingUpdate,
    onError(error) {
      toast.error(toErrorMessageText(error));
    },
  });
}

export function AppUpdateButton() {
  const pendingUpdateQuery = usePendingUpdateQuery();
  const installMutation = useInstallUpdateMutation();
  const pending = pendingUpdateQuery.data;

  if (!pending) {
    return null;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          aria-label={`Restart to update to version ${pending.version}`}
          disabled={installMutation.isPending}
          onClick={() => void installMutation.mutateAsync()}
          className="flex size-9 cursor-pointer items-center justify-center rounded-md text-emerald-400 transition-colors hover:bg-white/[0.06] disabled:pointer-events-none disabled:opacity-50"
        >
          <ArrowUpCircle className="size-[18px]" />
        </TooltipTrigger>
        <TooltipContent side="right">
          Restart now to update to v{pending.version}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
