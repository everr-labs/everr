import { ScrollArea } from "@everr/ui/components/scroll-area";
import { DeveloperUpdateSection } from "../desktop-shell/app-update";
import { PageTitleBar } from "../desktop-shell/title-bar";
import { DeveloperNotificationSection } from "../notifications/notification-window";
import { ErrorTrackingSection } from "./error-tracking-section";

export function DeveloperPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageTitleBar title="Developer" />
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid divide-y divide-white/[0.06]">
          <DeveloperNotificationSection />
          <DeveloperUpdateSection />
          <ErrorTrackingSection />
        </div>
      </ScrollArea>
    </div>
  );
}
