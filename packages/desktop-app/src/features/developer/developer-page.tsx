import { DeveloperUpdateSection } from "../desktop-shell/app-update";
import { PageTitleBar } from "../desktop-shell/title-bar";
import { DeveloperNotificationSection } from "../notifications/notification-window";
import { ErrorTrackingSection } from "./error-tracking-section";

export function DeveloperPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar title="Developer" />
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
