import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { invokeCommand, toErrorMessageText } from "../../lib/tauri";
import {
  FeatureErrorText,
  FeatureLoadingText,
  SettingsSection,
  WizardStepSection,
} from "../desktop-shell/ui";

export type CliInstallStatus = {
  status: "installed" | "not_installed";
  install_path: string;
};

export const cliInstallStatusQueryKey = ["desktop-app", "cli-install-status"] as const;

function getCliInstallStatus() {
  return invokeCommand<CliInstallStatus>("get_cli_install_status");
}

function installCli() {
  return invokeCommand<CliInstallStatus>("install_cli");
}

export function useCliInstallStatusQuery() {
  return useQuery({
    queryKey: cliInstallStatusQueryKey,
    queryFn: getCliInstallStatus,
  });
}

export function useInstallCliMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: installCli,
    onSuccess(data) {
      queryClient.setQueryData(cliInstallStatusQueryKey, data);
      toast.success("CLI installed.");
    },
    onError(error) {
      toast.error(toErrorMessageText(error));
    },
  });
}

export function CliInstallSection() {
  const cliInstallStatusQuery = useCliInstallStatusQuery();
  const installMutation = useInstallCliMutation();
  const cliInstalled = cliInstallStatusQuery.data?.status === "installed";

  if (cliInstalled) {
    return null;
  }

  return (
    <SettingsSection
      title="CLI"
      description="Install the bundled Everr CLI into your local bin directory. Everr will keep it updated automatically after that."
      action={
        <Button
          className="min-w-[132px] max-[620px]:w-full"
          disabled={cliInstallStatusQuery.isPending || cliInstallStatusQuery.isError || installMutation.isPending || cliInstalled}
          onClick={() => void installMutation.mutateAsync()}
        >
          {installMutation.isPending ? "Installing..." : cliInstalled ? "Installed" : "Install CLI"}
        </Button>
      }
    >
      {cliInstallStatusQuery.isPending ? (
        <FeatureLoadingText text="Loading CLI installation..." />
      ) : cliInstallStatusQuery.isError ? (
        <FeatureErrorText
          message={toErrorMessageText(cliInstallStatusQuery.error)}
          action={
            <Button variant="outline" size="sm" onClick={() => void cliInstallStatusQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
          Install path: <code>{cliInstallStatusQuery.data.install_path}</code>
        </p>
      )}
    </SettingsSection>
  );
}

export function CliInstallWizardStep() {
  const cliInstallStatusQuery = useCliInstallStatusQuery();
  const installMutation = useInstallCliMutation();
  const cliInstalled = cliInstallStatusQuery.data?.status === "installed";

  return (
    <WizardStepSection
      title="Install the Everr CLI"
      description="The desktop app bundles the CLI, installs it into your local bin directory, and keeps it updated automatically when the bundled binary changes."
      badge={<Badge variant="outline">{cliInstalled ? "Installed" : "Required"}</Badge>}
      action={
        <Button
          className="min-w-[132px] cursor-pointer"
          onClick={() => void installMutation.mutateAsync()}
        >
          {installMutation.isPending ? "Installing..." : cliInstalled ? "Installed" : "Install CLI"}
        </Button>
      }
    >
      {cliInstallStatusQuery.isPending ? (
        <FeatureLoadingText text="Loading CLI installation..." />
      ) : cliInstallStatusQuery.isError ? (
        <FeatureErrorText
          message={toErrorMessageText(cliInstallStatusQuery.error)}
          action={
            <Button variant="outline" size="sm" onClick={() => void cliInstallStatusQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        null
      )}
    </WizardStepSection>
  );
}
