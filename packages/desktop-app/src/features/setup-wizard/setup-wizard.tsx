import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Separator } from "../../components/ui/separator";
import { invokeCommand, toErrorMessageText } from "../../lib/tauri";
import { useAuthStatusQuery } from "../auth/auth";
import {
  AssistantsWizardStep,
  useAssistantSetupQuery,
  useMarkAssistantStepSeenMutation,
} from "../assistants/assistants";
import { CliInstallWizardStep, useCliInstallStatusQuery } from "../cli-install/cli-install";
import {
  LaunchAtLoginWizardStep,
  useLaunchAtLoginStatusQuery,
  useMarkLaunchAtLoginStepSeenMutation,
} from "../launch-at-login/launch-at-login";
import { FeatureErrorText, FeatureLoadingText } from "../desktop-shell/ui";
import { AuthWizardStep } from "../auth/auth";

const WIZARD_STEPS = [
  { id: "authenticate", label: "Authenticate" },
  { id: "assistants", label: "Assistants" },
  { id: "cli", label: "Install CLI" },
  { id: "launch", label: "Launch at login" },
] as const;

export type WizardStatus = {
  wizard_completed: boolean;
};

export const wizardStatusQueryKey = ["desktop-app", "wizard-status"] as const;

function getWizardStatus() {
  return invokeCommand<WizardStatus>("get_wizard_status");
}

function completeSetupWizard() {
  return invokeCommand<WizardStatus>("complete_setup_wizard");
}

export function useWizardStatusQuery() {
  return useQuery({
    queryKey: wizardStatusQueryKey,
    queryFn: getWizardStatus,
  });
}

export function useCompleteSetupWizardMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: completeSetupWizard,
    onSuccess(data) {
      queryClient.setQueryData(wizardStatusQueryKey, data);
      toast.success("Setup complete.");
    },
    onError(error) {
      toast.error(toErrorMessageText(error));
    },
  });
}

export function SetupWizard() {
  const authStatusQuery = useAuthStatusQuery();
  const assistantSetupQuery = useAssistantSetupQuery();
  const cliInstallStatusQuery = useCliInstallStatusQuery();
  const launchAtLoginStatusQuery = useLaunchAtLoginStatusQuery();
  const markAssistantStepSeenMutation = useMarkAssistantStepSeenMutation();
  const markLaunchAtLoginStepSeenMutation = useMarkLaunchAtLoginStepSeenMutation();
  const completeSetupMutation = useCompleteSetupWizardMutation();
  const [wizardStep, setWizardStep] = useState<number | null>(null);

  const signedIn = authStatusQuery.data?.status === "signed_in";
  const cliInstalled = cliInstallStatusQuery.data?.status === "installed";
  const assistantStepSeen = assistantSetupQuery.data?.assistant_step_seen ?? false;
  const launchStepSeen = launchAtLoginStatusQuery.data?.launch_at_login_step_seen ?? false;
  const derivedStep = resolveWizardStepIndex({
    signedIn,
    assistantStepSeen,
    cliInstalled,
    launchStepSeen,
  });
  const currentStep = wizardStep ?? derivedStep;
  const isLastStep = currentStep === WIZARD_STEPS.length - 1;
  const missingInitialData =
    !authStatusQuery.data ||
    !assistantSetupQuery.data ||
    !cliInstallStatusQuery.data ||
    !launchAtLoginStatusQuery.data;

  useEffect(() => {
    setWizardStep((current) => {
      if (current === null) {
        return derivedStep;
      }

      return current < derivedStep ? derivedStep : current;
    });
  }, [derivedStep]);

  async function handleContinue() {
    if (currentStep === 1 && !assistantStepSeen) {
      await markAssistantStepSeenMutation.mutateAsync();
      return;
    }

    if (currentStep === WIZARD_STEPS.length - 1) {
      if (!launchStepSeen) {
        await markLaunchAtLoginStepSeenMutation.mutateAsync();
      }
      await completeSetupMutation.mutateAsync();
      return;
    }

    setWizardStep((value) => Math.min((value ?? derivedStep) + 1, WIZARD_STEPS.length - 1));
  }

  if (missingInitialData && hasPendingQuery([authStatusQuery.isPending, assistantSetupQuery.isPending, cliInstallStatusQuery.isPending, launchAtLoginStatusQuery.isPending])) {
    return (
      <div className="grid gap-0">
        <div className="px-6 py-6 max-[620px]:px-5">
          <Card className="border-[color:var(--settings-border-soft)] bg-[var(--settings-panel-strong)]">
            <CardContent className="px-5 py-5">
              <FeatureLoadingText text="Loading wizard state..." />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (missingInitialData) {
    const firstError = [
      authStatusQuery.error,
      assistantSetupQuery.error,
      cliInstallStatusQuery.error,
      launchAtLoginStatusQuery.error,
    ].find((error) => error !== null);

    return (
      <div className="grid gap-0">
        <div className="px-6 py-6 max-[620px]:px-5">
          <Card className="border-[color:var(--settings-border-soft)] bg-[var(--settings-panel-strong)]">
            <CardContent className="px-5 py-5">
              <FeatureErrorText
                message={toErrorMessageText(firstError)}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void authStatusQuery.refetch();
                      void assistantSetupQuery.refetch();
                      void cliInstallStatusQuery.refetch();
                      void launchAtLoginStatusQuery.refetch();
                    }}
                  >
                    Retry
                  </Button>
                }
              />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const continueDisabled =
    markAssistantStepSeenMutation.isPending ||
    markLaunchAtLoginStepSeenMutation.isPending ||
    completeSetupMutation.isPending ||
    (currentStep === 0 && !signedIn) ||
    (currentStep === 2 && !cliInstalled) ||
    (isLastStep && !(signedIn && cliInstalled));

  return (
    <div className="grid gap-0">
      <div className="px-6 py-6 max-[620px]:px-5">
        <Card className="border-[color:var(--settings-border-soft)] bg-[var(--settings-panel-strong)]">
          <CardContent className="grid gap-5 px-5 py-5">
            {currentStep === 0 ? <AuthWizardStep /> : null}
            {currentStep === 1 ? (
              <AssistantsWizardStep assistantSetup={assistantSetupQuery.data} />
            ) : null}
            {currentStep === 2 ? <CliInstallWizardStep /> : null}
            {currentStep === 3 ? <LaunchAtLoginWizardStep /> : null}
          </CardContent>
        </Card>
      </div>

      <Separator className="bg-[var(--settings-border-soft)]" />

      <div className="flex items-center justify-between gap-3 px-6 py-5 max-[620px]:flex-col max-[620px]:items-stretch max-[620px]:px-5">
        <Button
          variant="ghost"
          disabled={currentStep === 0}
          onClick={() => setWizardStep((value) => Math.max((value ?? derivedStep) - 1, 0))}
        >
          Back
        </Button>

        <div className="flex flex-wrap justify-end gap-2 max-[620px]:w-full">
          <Button
            variant={isLastStep ? "default" : "outline"}
            className="min-w-[132px] max-[620px]:w-full"
            disabled={continueDisabled}
            onClick={() => void handleContinue()}
          >
            {completeSetupMutation.isPending
              ? "Finishing..."
              : isLastStep
                ? "Finish"
                : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function hasPendingQuery(queries: boolean[]) {
  return queries.some(Boolean);
}

function resolveWizardStepIndex({
  signedIn,
  assistantStepSeen,
  cliInstalled,
  launchStepSeen,
}: {
  signedIn: boolean;
  assistantStepSeen: boolean;
  cliInstalled: boolean;
  launchStepSeen: boolean;
}) {
  if (!signedIn) {
    return 0;
  }

  if (!assistantStepSeen) {
    return 1;
  }

  if (!cliInstalled) {
    return 2;
  }

  if (!launchStepSeen) {
    return 3;
  }

  return 3;
}
