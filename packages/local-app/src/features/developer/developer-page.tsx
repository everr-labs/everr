import { PageHeader, ScrollingPageContainer } from "@everr/app-shell/page";
import { ErrorTrackingCard } from "./error-tracking-card";

export function DeveloperPage() {
  return (
    <ScrollingPageContainer>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
        <PageHeader title="Developer" lede="Tools for testing Everr from a development build." />
        <ErrorTrackingCard />
      </div>
    </ScrollingPageContainer>
  );
}
