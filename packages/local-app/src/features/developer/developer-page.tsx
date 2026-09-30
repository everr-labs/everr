import { SectionsPage } from "../app-shell/title-bar";
import { ErrorTrackingSection } from "./error-tracking-section";

export function DeveloperPage() {
  return (
    <SectionsPage title="Developer">
      <ErrorTrackingSection />
    </SectionsPage>
  );
}
