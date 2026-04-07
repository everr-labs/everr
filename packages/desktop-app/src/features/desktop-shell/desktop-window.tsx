import { Toaster } from "@everr/ui/components/sonner";
import { APP_DISPLAY_NAME } from "@/lib/app-name";
import { toErrorMessageText } from "@/lib/tauri";
import {
  SetupWizard,
  useWizardStatusQuery,
} from "../setup-wizard/setup-wizard";
import { AppShell } from "./app-shell";
import { DesktopFrame, DesktopLoadingState } from "./ui";

export function DesktopWindow() {
  const wizardStatusQuery = useWizardStatusQuery();

  if (wizardStatusQuery.isPending) {
    return <DesktopLoadingState text={`Loading ${APP_DISPLAY_NAME}...`} />;
  }

  if (wizardStatusQuery.isError) {
    return (
      <DesktopLoadingState text={toErrorMessageText(wizardStatusQuery.error)} />
    );
  }

  const wizardStatus = wizardStatusQuery.data;
  if (!wizardStatus) {
    return <DesktopLoadingState text={`Loading ${APP_DISPLAY_NAME}...`} />;
  }

  const showingWizard = !wizardStatus.wizard_completed;

  if (showingWizard) {
    return (
      <>
        <Toaster
          closeButton
          position="top-right"
          richColors
          visibleToasts={1}
        />
        <DesktopFrame
          title="Installation wizard"
          description="Authenticate and choose assistant integrations."
        >
          <SetupWizard />
        </DesktopFrame>
      </>
    );
  }

  return (
    <>
      <Toaster closeButton position="top-right" richColors visibleToasts={1} />
      <AppShell />
    </>
  );
}
