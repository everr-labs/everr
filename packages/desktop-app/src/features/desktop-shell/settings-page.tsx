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
    <div className="pt-8">
      <div className="px-6 pb-5">
        <div className="grid gap-1.5">
          <h1 className="m-0 text-[clamp(1.4rem,3vw,1.8rem)] font-medium leading-none tracking-[-0.04em]">
            Settings
          </h1>
          <p className="m-0 max-w-[52ch] text-[0.92rem] leading-6 text-[var(--settings-text-muted)]">
            Manage your desktop connection, notifications, and release info.
          </p>
        </div>
      </div>
      <div className="grid divide-y divide-white/[0.06]">
        <div className="pt-0">
          <AuthSettingsSection />
        </div>
        <NotificationEmailsSection />
        <BuildInfoSection />
      </div>
    </div>
  );
}
