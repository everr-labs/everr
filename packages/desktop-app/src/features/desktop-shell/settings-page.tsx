import { AssistantsSection } from "../assistants/assistants";
import { AuthSettingsSection } from "../auth/auth";
import { NotificationEmailsSection } from "../notifications/notification-emails-section";

export function SettingsPage() {
  return (
    <div className="pt-8">
      <div className="px-6 pb-5">
        <div className="grid gap-1.5">
          <h1 className="m-0 text-[clamp(1.4rem,3vw,1.8rem)] font-medium leading-none tracking-[-0.04em]">
            Settings
          </h1>
          <p className="m-0 max-w-[52ch] text-[0.92rem] leading-6 text-[var(--settings-text-muted)]">
            Manage your desktop connection and assistant integrations.
          </p>
        </div>
      </div>
      <div className="grid divide-y divide-white/[0.06]">
        <div className="pt-0">
          <AuthSettingsSection />
        </div>
        <AssistantsSection />
        <NotificationEmailsSection />
      </div>
    </div>
  );
}
