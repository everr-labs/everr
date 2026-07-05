import { Button } from "@everr/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpCircle } from "lucide-react";
import { toast } from "sonner";
import { invokeCommand, toErrorMessageText, UPDATE_AVAILABLE_EVENT } from "../../lib/tauri";
import { useInvalidateOnTauriEvent } from "../../lib/tauri-events";
import { SettingsSection } from "./ui";

// Version reported by the dev-only "simulate update" toggle.
const SIMULATED_UPDATE_VERSION = "9.9.9";

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

function setSimulatedUpdate(version: string | null) {
  return invokeCommand<void>("set_simulated_update", { version });
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

function useSimulateUpdateMutation() {
  // No onSuccess: the backend emits UPDATE_AVAILABLE_EVENT, which
  // usePendingUpdateQuery already invalidates on, refreshing every surface.
  return useMutation({
    mutationFn: setSimulatedUpdate,
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
        <TooltipContent side="right">Restart now to update to v{pending.version}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function DeveloperUpdateSection() {
  const pendingUpdateQuery = usePendingUpdateQuery();
  const simulateMutation = useSimulateUpdateMutation();
  const hasUpdate = !!pendingUpdateQuery.data;

  return (
    <SettingsSection
      title="App update"
      description="Toggle a simulated staged update to preview the sidebar control, tray badge, and tray menu item. Not installable."
      compact
    >
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="min-w-[136px] max-[620px]:w-full"
          disabled={simulateMutation.isPending}
          onClick={() =>
            void simulateMutation.mutateAsync(hasUpdate ? null : SIMULATED_UPDATE_VERSION)
          }
        >
          {hasUpdate ? "Clear update" : "Simulate update"}
        </Button>
      </div>
    </SettingsSection>
  );
}
