import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@everr/ui/components/button";
import { Card, CardContent } from "@everr/ui/components/card";
import { Separator } from "@everr/ui/components/separator";
import { closeCurrentWindow, invokeCommand, toErrorMessageText } from "@/lib/tauri";
import { useAuthStatusQuery } from "../auth/auth";
import {
  type AssistantKind,
  AssistantsWizardStep,
  useAssistantSetupQuery,
  useSaveAssistantsMutation,
} from "../assistants/assistants";
import { FeatureErrorText, FeatureLoadingText } from "../desktop-shell/ui";
import { AuthWizardStep } from "../auth/auth";

const WIZARD_STEPS = [
  { id: "authenticate", label: "Authenticate" },
  { id: "assistants", label: "Assistants" },
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
  return useMutation({
    mutationFn: completeSetupWizard,
    onSuccess() {
      toast.success("Setup complete.");
    },
    onError(error) {
      toast.error(toErrorMessageText(error));
    },
  });
}

export function SetupWizard() {
  const queryClient = useQueryClient();
  const authStatusQuery = useAuthStatusQuery();
  const assistantSetupQuery = useAssistantSetupQuery();
  const saveAssistantsMutation = useSaveAssistantsMutation();
  const completeSetupMutation = useCompleteSetupWizardMutation();
  const [wizardStep, setWizardStep] = useState<number | null>(null);
  const [assistantSelection, setAssistantSelection] = useState<AssistantKind[]>([]);

  const signedIn = authStatusQuery.data?.status === "signed_in";
  const derivedStep = resolveWizardStepIndex({ signedIn });
  const currentStep = wizardStep ?? derivedStep;
  const isLastStep = currentStep === WIZARD_STEPS.length - 1;
  const missingInitialData = !authStatusQuery.data || !assistantSetupQuery.data;

  useEffect(() => {
    setWizardStep((current) => {
      if (current === null) {
        return derivedStep;
      }

      return current < derivedStep ? derivedStep : current;
    });
  }, [derivedStep]);

  useEffect(() => {
    if (!assistantSetupQuery.data) {
      return;
    }

    setAssistantSelection(
      assistantSetupQuery.data.assistant_statuses
        .filter((status) => status.configured)
        .map((status) => status.assistant),
    );
  }, [assistantSetupQuery.data]);

  async function handleContinue() {
    if (currentStep === 1) {
      await saveAssistantsMutation.mutateAsync(assistantSelection);
    }

    if (currentStep === WIZARD_STEPS.length - 1) {
      const wizardStatus = await completeSetupMutation.mutateAsync();
      try {
        await closeCurrentWindow();
      } finally {
        queryClient.setQueryData(wizardStatusQueryKey, wizardStatus);
      }
      return;
    }

    setWizardStep((value) => Math.min((value ?? derivedStep) + 1, WIZARD_STEPS.length - 1));
  }

  if (
    missingInitialData &&
    hasPendingQuery([authStatusQuery.isPending, assistantSetupQuery.isPending])
  ) {
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
    const firstError = [authStatusQuery.error, assistantSetupQuery.error].find((error) => error !== null);

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
    saveAssistantsMutation.isPending ||
    completeSetupMutation.isPending ||
    (currentStep === 0 && !signedIn) ||
    (isLastStep && !signedIn);

  return (
    <div className="grid gap-0">
      <div className="px-6 pb-6 pt-0 max-[620px]:px-5">
        <Card className="border-[color:var(--settings-border-soft)] bg-[var(--settings-panel-strong)]">
          <CardContent className="grid gap-5 px-5 py-5">
            {currentStep === 0 ? <AuthWizardStep /> : null}
            {currentStep === 1 ? (
                <AssistantsWizardStep
                  assistantSetup={assistantSetupQuery.data}
                  selection={assistantSelection}
                  disabled={saveAssistantsMutation.isPending}
                  onToggle={(assistant) =>
                    setAssistantSelection((current) =>
                      current.includes(assistant)
                      ? current.filter((item) => item !== assistant)
                      : [...current, assistant],
                  )
                }
              />
            ) : null}
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
}: {
  signedIn: boolean;
}) {
  if (!signedIn) {
    return 0;
  }

  return 1;
}
