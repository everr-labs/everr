import { DeveloperNotificationSection } from "../notifications/notification-window";

export function DeveloperPage() {
  return (
    <div className="pt-8">
      <div className="px-6 pb-5">
        <div className="grid gap-1.5">
          <h1 className="m-0 text-[clamp(1.4rem,3vw,1.8rem)] font-medium leading-none tracking-[-0.04em]">
            Developer
          </h1>
          <p className="m-0 max-w-[52ch] text-[0.92rem] leading-6 text-[var(--settings-text-muted)]">
            Preview notifications and reset local app state.
          </p>
        </div>
      </div>
      <div className="grid divide-y divide-white/[0.06]">
        <DeveloperNotificationSection />
      </div>
    </div>
  );
}
