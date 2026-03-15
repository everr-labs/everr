import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { SETTINGS_CHANGED_EVENT, invokeCommand, toErrorMessageText } from "../../lib/tauri";
import { useInvalidateOnTauriEvent } from "../../lib/tauri-events";
import {
  FeatureErrorText,
  FeatureLoadingText,
  SettingsSection,
  WizardStepSection,
} from "../desktop-shell/ui";

export type LaunchAtLoginStatus = {
  launch_at_login_enabled: boolean;
  launch_at_login_step_seen: boolean;
};

export const launchAtLoginStatusQueryKey = ["desktop-app", "launch-at-login-status"] as const;

function getLaunchAtLoginStatus() {
  return invokeCommand<LaunchAtLoginStatus>("get_launch_at_login_status");
}

function setLaunchAtLogin(enabled: boolean) {
  return invokeCommand<LaunchAtLoginStatus>("set_launch_at_login", { enabled });
}

function markLaunchAtLoginStepSeen() {
  return invokeCommand<LaunchAtLoginStatus>("mark_launch_at_login_step_seen");
}

export function useLaunchAtLoginStatusQuery() {
  useInvalidateOnTauriEvent(SETTINGS_CHANGED_EVENT, (queryClient) => {
    void queryClient.invalidateQueries({ queryKey: launchAtLoginStatusQueryKey });
  });

  return useQuery({
    queryKey: launchAtLoginStatusQueryKey,
    queryFn: getLaunchAtLoginStatus,
  });
}

export function useSetLaunchAtLoginMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: setLaunchAtLogin,
    onSuccess(data, enabled) {
      queryClient.setQueryData(launchAtLoginStatusQueryKey, data);
      toast.success(enabled ? "Launch at login enabled." : "Launch at login disabled.");
    },
    onError(error) {
      toast.error(toErrorMessageText(error));
    },
  });
}

export function useMarkLaunchAtLoginStepSeenMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markLaunchAtLoginStepSeen,
    onSuccess(data) {
      queryClient.setQueryData(launchAtLoginStatusQueryKey, data);
    },
    onError(error) {
      toast.error(toErrorMessageText(error));
    },
  });
}

export function LaunchAtLoginSection() {
  const launchAtLoginQuery = useLaunchAtLoginStatusQuery();
  const setLaunchMutation = useSetLaunchAtLoginMutation();
  const enabled = launchAtLoginQuery.data?.launch_at_login_enabled ?? false;

  if (enabled) {
    return null;
  }

  return (
    <SettingsSection
      title="Background tasks"
      description="Control whether Everr should start automatically after you log in."
      action={
        <Button
          className="min-w-[132px] max-[620px]:w-full"
          disabled={launchAtLoginQuery.isPending || launchAtLoginQuery.isError || setLaunchMutation.isPending}
          onClick={() => void setLaunchMutation.mutateAsync(!enabled)}
        >
          {setLaunchMutation.isPending ? "Saving..." : enabled ? "Disable" : "Enable"}
        </Button>
      }
    >
      {launchAtLoginQuery.isPending ? (
        <FeatureLoadingText text="Loading background startup settings..." />
      ) : launchAtLoginQuery.isError ? (
        <FeatureErrorText
          message={toErrorMessageText(launchAtLoginQuery.error)}
          action={
            <Button variant="outline" size="sm" onClick={() => void launchAtLoginQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
          On macOS, the system may show a Login Items or Background Items approval prompt after
          enabling this.
        </p>
      )}
    </SettingsSection>
  );
}

export function LaunchAtLoginWizardStep() {
  const launchAtLoginQuery = useLaunchAtLoginStatusQuery();
  const setLaunchMutation = useSetLaunchAtLoginMutation();
  const skipMutation = useMarkLaunchAtLoginStepSeenMutation();
  const enabled = launchAtLoginQuery.data?.launch_at_login_enabled ?? false;
  const disabled =
    launchAtLoginQuery.isPending ||
    launchAtLoginQuery.isError ||
    setLaunchMutation.isPending ||
    skipMutation.isPending;

  return (
    <WizardStepSection
      title="Enable background startup"
      description="If you enable launch at login, Everr will start automatically after sign-in so the tray app can keep watching your current repository."
      badge={<Badge variant="outline">{enabled ? "Enabled" : "Optional"}</Badge>}
      action={
        <div className="flex flex-wrap gap-2">
          <Button
            className="min-w-[132px]"
            disabled={disabled}
            onClick={() => void setLaunchMutation.mutateAsync(!enabled)}
          >
            {setLaunchMutation.isPending ? "Saving..." : enabled ? "Disable" : "Enable"}
          </Button>
        </div>
      }
    >
      {launchAtLoginQuery.isPending ? (
        <FeatureLoadingText text="Loading background startup settings..." />
      ) : launchAtLoginQuery.isError ? (
        <FeatureErrorText
          message={toErrorMessageText(launchAtLoginQuery.error)}
          action={
            <Button variant="outline" size="sm" onClick={() => void launchAtLoginQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
          On macOS, the system may ask you to approve Everr in Login Items or Background Items
          after enabling this.
        </p>
      )}
    </WizardStepSection>
  );
}
