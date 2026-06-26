import { Button } from "@everr/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  invokeCommand,
  SETTINGS_CHANGED_EVENT,
  toErrorMessageText,
} from "@/lib/tauri";
import { useInvalidateOnTauriEvent } from "../../lib/tauri-events";
import {
  FeatureErrorText,
  FeatureLoadingText,
  SettingsSection,
} from "../desktop-shell/ui";

type SkillProvider = "codex" | "claude-code" | "cursor";

type SkillProviderState = {
  provider: SkillProvider;
  detected: boolean;
  installed: boolean;
};

const PROVIDER_LABELS: Record<SkillProvider, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
};

const skillsStatusQueryKey = ["desktop-app", "skills-status"] as const;

function getSkillsStatus() {
  return invokeCommand<SkillProviderState[]>("get_skills_status");
}

function installSkills(providers: SkillProvider[]) {
  return invokeCommand<void>("install_skills", { providers });
}

const SECTION_DESCRIPTION =
  "Skills teach your coding agents to work with CI and your telemetry.";

export function SkillsSection() {
  const queryClient = useQueryClient();

  useInvalidateOnTauriEvent(SETTINGS_CHANGED_EVENT, (qc) => {
    void qc.invalidateQueries({ queryKey: skillsStatusQueryKey });
  });

  const statusQuery = useQuery({
    queryKey: skillsStatusQueryKey,
    queryFn: getSkillsStatus,
  });

  const mutation = useMutation({
    mutationFn: installSkills,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: skillsStatusQueryKey });
    },
    onError: (error) => {
      toast.error(toErrorMessageText(error));
    },
  });

  if (statusQuery.isPending) {
    return (
      <SettingsSection title="Agent skills" description={SECTION_DESCRIPTION}>
        <FeatureLoadingText text="Loading skills..." />
      </SettingsSection>
    );
  }

  if (statusQuery.isError) {
    return (
      <SettingsSection title="Agent skills" description={SECTION_DESCRIPTION}>
        <FeatureErrorText message="Failed to load skills status." />
      </SettingsSection>
    );
  }

  const providers = statusQuery.data ?? [];

  return (
    <SettingsSection title="Agent skills" description={SECTION_DESCRIPTION}>
      <div className="grid max-w-[680px] gap-2">
        {providers.map((provider) => (
          <div
            key={provider.provider}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-[var(--settings-text)]">
              {PROVIDER_LABELS[provider.provider]}
            </span>
            {provider.installed ? (
              <span className="text-[var(--settings-text-muted)]">
                Installed
              </span>
            ) : provider.detected ? (
              <Button
                variant="outline"
                size="sm"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate([provider.provider])}
              >
                {mutation.isPending ? "Installing..." : "Install"}
              </Button>
            ) : (
              <span className="text-[var(--settings-text-muted)]">
                Agent not detected
              </span>
            )}
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}
