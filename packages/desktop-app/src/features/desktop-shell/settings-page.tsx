import { useQuery } from "@tanstack/react-query";
import { invokeCommand } from "@/lib/tauri";
import { AuthSettingsSection } from "../auth/auth";
import { NotificationEmailsSection } from "../notifications/notification-emails-section";
import { SettingsSection } from "./ui";

type BuildInfo = {
  platform_version: string;
  release_sha: string;
  release_short_sha: string;
};

const buildInfoQueryKey = ["desktop-app", "build-info"] as const;

function BuildInfoSection() {
  const buildInfoQuery = useQuery({
    queryKey: buildInfoQueryKey,
    queryFn: () => invokeCommand<BuildInfo>("get_build_info"),
  });

  return (
    <SettingsSection
      title="Release"
      description="Build identity for this desktop app."
      compact
    >
      <dl className="grid max-w-[420px] grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-[var(--settings-text-muted)]">SHA</dt>
        <dd className="m-0 font-mono text-[var(--settings-text)]">
          {buildInfoQuery.data?.release_short_sha ?? "unknown"}
        </dd>
      </dl>
    </SettingsSection>
  );
}

export function SettingsPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="relative z-10 flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
        <div
          data-tauri-drag-region
          className="flex flex-1 items-center self-stretch pl-[var(--titlebar-inset)]"
        >
          <span className="text-sm font-medium text-[var(--settings-text)]">
            Settings
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid divide-y divide-white/[0.06]">
          <div className="pt-0">
            <AuthSettingsSection />
          </div>
          <NotificationEmailsSection />
          <BuildInfoSection />
        </div>
      </div>
    </div>
  );
}
