import { DeveloperUpdateSection } from "../desktop-shell/app-update";
import { SectionsPage } from "../desktop-shell/title-bar";
import { DeveloperNotificationSection } from "../notifications/notification-window";
import { ErrorTrackingSection } from "./error-tracking-section";

export function DeveloperPage() {
  return (
    <SectionsPage title="Developer">
      <DeveloperNotificationSection />
      <DeveloperUpdateSection />
      <ErrorTrackingSection />
    </SectionsPage>
  );
}
