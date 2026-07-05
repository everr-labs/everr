import { Button } from "@everr/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { invokeCommand, SETTINGS_CHANGED_EVENT, toErrorMessageText } from "@/lib/tauri";
import { useInvalidateOnTauriEvent } from "../../lib/tauri-events";
import { FeatureErrorText, FeatureLoadingText, SettingsSection } from "../desktop-shell/ui";

type SkillProvider = "codex" | "claude-code" | "cursor";

type SkillProviderState = {
  provider: SkillProvider;
  display_name: string;
  detected: boolean;
  installed: boolean;
};

// Stable, friendly display order (Claude Code first), independent of the order
// the backend enumerates providers in.
const PROVIDER_ORDER: SkillProvider[] = ["claude-code", "codex", "cursor"];

const skillsStatusQueryKey = ["desktop-app", "skills-status"] as const;

function getSkillsStatus() {
  return invokeCommand<SkillProviderState[]>("get_skills_status");
}

function installSkills(providers: SkillProvider[]) {
  return invokeCommand<void>("install_skills", { providers });
}

const SECTION_DESCRIPTION =
  "Skills teach your coding agents to work with CI and use your telemetry.";

export function SkillsSection() {
  const queryClient = useQueryClient();

  useInvalidateOnTauriEvent(SETTINGS_CHANGED_EVENT, (qc) => {
    void qc.invalidateQueries({ queryKey: skillsStatusQueryKey });
  });

  const statusQuery = useQuery({
    queryKey: skillsStatusQueryKey,
    queryFn: getSkillsStatus,
  });

  const installMutation = useMutation({
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

  // Scope the loading state to the agent actually being installed, so clicking
  // "Install" on one row doesn't put every other row into a loading state.
  const installingProvider = installMutation.isPending ? installMutation.variables?.[0] : undefined;

  const providers = [...(statusQuery.data ?? [])].sort(
    (a, b) => PROVIDER_ORDER.indexOf(a.provider) - PROVIDER_ORDER.indexOf(b.provider),
  );

  return (
    <SettingsSection title="Agent skills" description={SECTION_DESCRIPTION}>
      <ul className="grid gap-3">
        {providers.map((provider) => (
          <li key={provider.provider} className="flex min-h-8 items-center justify-between gap-4">
            <span className="text-sm text-[var(--settings-text)]">{provider.display_name}</span>
            {provider.installed ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
                <Check className="size-3.5" aria-hidden="true" />
                Installed
              </span>
            ) : provider.detected ? (
              <Button
                variant="outline"
                size="sm"
                disabled={installMutation.isPending}
                onClick={() => installMutation.mutate([provider.provider])}
              >
                {installingProvider === provider.provider ? "Installing..." : "Install"}
              </Button>
            ) : (
              <span className="text-sm text-[var(--settings-text-muted)]">Not detected</span>
            )}
          </li>
        ))}
      </ul>
    </SettingsSection>
  );
}
