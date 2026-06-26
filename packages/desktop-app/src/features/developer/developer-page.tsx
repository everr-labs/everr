import { DeveloperUpdateSection } from "../desktop-shell/app-update";
import { DeveloperNotificationSection } from "../notifications/notification-window";
import { ErrorTrackingSection } from "./error-tracking-section";

export function DeveloperPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="relative z-10 flex h-12 shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
        {/* flex-1 so the empty space stays a window drag handle (Tauri). */}
        <div
          data-tauri-drag-region
          className="flex flex-1 items-center self-stretch pl-[var(--titlebar-inset)]"
        >
          <span className="text-sm font-medium text-[var(--settings-text)]">
            Developer
          </span>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid divide-y divide-white/[0.06]">
          <DeveloperNotificationSection />
          <DeveloperUpdateSection />
          <ErrorTrackingSection />
        </div>
      </div>
    </div>
  );
}
