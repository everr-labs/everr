import { Button } from "@everr/ui/components/button";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  invokeCommand,
  SETTINGS_CHANGED_EVENT,
  toErrorMessageText,
} from "../../lib/tauri";
import { useInvalidateOnTauriEvent } from "../../lib/tauri-events";
import {
  FeatureErrorText,
  FeatureLoadingText,
  SettingsSection,
} from "../desktop-shell/ui";

export type AssistantKind = "codex" | "claude" | "cursor";

export type AssistantStatus = {
  assistant: AssistantKind;
  detected: boolean;
  configured: boolean;
  path: string;
};

export type AssistantSetup = {
  assistant_statuses: AssistantStatus[];
};

export const assistantSetupQueryKey = [
  "desktop-app",
  "assistant-setup",
] as const;

function getAssistantSetup() {
  return invokeCommand<AssistantSetup>("get_assistant_setup");
}

function configureAssistants(assistants: AssistantKind[]) {
  return invokeCommand<AssistantSetup>("configure_assistants", { assistants });
}

export function useAssistantSetupQuery() {
  useInvalidateOnTauriEvent(SETTINGS_CHANGED_EVENT, (queryClient) => {
    void queryClient.invalidateQueries({ queryKey: assistantSetupQueryKey });
  });

  return useQuery({
    queryKey: assistantSetupQueryKey,
    queryFn: getAssistantSetup,
  });
}

export function useSaveAssistantsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: configureAssistants,
    onSuccess(data) {
      queryClient.setQueryData(assistantSetupQueryKey, data);
    },
    onError(error) {
      toast.error(toErrorMessageText(error));
    },
  });
}

export function AssistantsSection() {
  const assistantSetupQuery = useAssistantSetupQuery();

  if (assistantSetupQuery.isPending) {
    return (
      <SettingsSection
        title="Assistants"
        description="Manage the Codex, Claude, and Cursor instruction files Everr owns on this machine."
      >
        <FeatureLoadingText text="Loading assistant integrations..." />
      </SettingsSection>
    );
  }

  if (assistantSetupQuery.isError) {
    return (
      <SettingsSection
        title="Assistants"
        description="Manage the Codex, Claude, and Cursor instruction files Everr owns on this machine."
      >
        <FeatureErrorText
          message={toErrorMessageText(assistantSetupQuery.error)}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void assistantSetupQuery.refetch()}
            >
              Retry
            </Button>
          }
        />
      </SettingsSection>
    );
  }

  return <LoadedAssistantsSection assistantSetup={assistantSetupQuery.data} />;
}

function LoadedAssistantsSection({
  assistantSetup,
}: {
  assistantSetup: AssistantSetup;
}) {
  const saveMutation = useSaveAssistantsMutation();
  const { selection, setDraftFromServer, resetDraft, toggleAssistant } =
    useAssistantSelectionDraft(
      configuredAssistantsFromStatuses(assistantSetup.assistant_statuses),
    );

  async function handleSave() {
    const next = await saveMutation.mutateAsync(selection);
    setDraftFromServer(
      configuredAssistantsFromStatuses(next.assistant_statuses),
    );
  }

  return (
    <SettingsSection
      title="Assistants"
      description="Add instructions to your assistants on how to use Everr."
    >
      <AssistantChecklist
        selection={selection}
        statuses={assistantSetup.assistant_statuses}
        disabled={saveMutation.isPending}
        onToggle={toggleAssistant}
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={saveMutation.isPending}
          onClick={resetDraft}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={saveMutation.isPending}
          onClick={() => void handleSave()}
        >
          {saveMutation.isPending ? "Saving..." : "Save integrations"}
        </Button>
      </div>
    </SettingsSection>
  );
}

function configuredAssistantsFromStatuses(
  statuses: AssistantStatus[],
): AssistantKind[] {
  return statuses
    .filter((status) => status.configured)
    .map((status) => status.assistant);
}

function useAssistantSelectionDraft(
  serverSelection: AssistantKind[],
  onChange?: (selection: AssistantKind[]) => void,
) {
  const [selection, setSelection] = useState<AssistantKind[]>(serverSelection);
  const [isDirty, setIsDirty] = useState(false);
  const serverSelectionKey = serverSelection.join("|");

  useEffect(() => {
    if (!isDirty) {
      setSelection(serverSelection);
    }
  }, [isDirty, serverSelectionKey]);

  return {
    selection,
    isDirty,
    setDraftFromServer(nextSelection: AssistantKind[]) {
      setSelection(nextSelection);
      setIsDirty(false);
    },
    resetDraft() {
      setSelection(serverSelection);
      setIsDirty(false);
    },
    toggleAssistant(assistant: AssistantKind) {
      setIsDirty(true);
      setSelection((current) => {
        const next = current.includes(assistant)
          ? current.filter((item) => item !== assistant)
          : [...current, assistant];
        onChange?.(next);
        return next;
      });
    },
  };
}

function AssistantChecklist({
  selection,
  statuses,
  disabled,
  onToggle,
}: {
  selection: AssistantKind[];
  statuses: AssistantStatus[];
  disabled: boolean;
  onToggle: (assistant: AssistantKind) => void;
}) {
  return (
    <div className="grid gap-2">
      {statuses.map((status) => {
        const checked = selection.includes(status.assistant);

        return (
          <label
            key={status.assistant}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
              disabled && "cursor-not-allowed opacity-70",
              checked
                ? "border-white/15 bg-white/[0.06]"
                : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]",
            )}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => onToggle(status.assistant)}
              className="h-4 w-4 shrink-0 rounded border-white/20 bg-transparent accent-white"
            />
            <span className="text-sm font-medium text-[var(--settings-text)]">
              {assistantLabel(status.assistant)}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function assistantLabel(assistant: AssistantKind): string {
  switch (assistant) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude";
    case "cursor":
      return "Cursor";
  }
}
