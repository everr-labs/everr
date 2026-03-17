import { Separator } from "../../components/ui/separator";
import { Toaster } from "../../components/ui/sonner";
import { APP_DISPLAY_NAME } from "../../lib/app-name";
import { toErrorMessageText } from "../../lib/tauri";
import { AccountHeaderAction, AuthSettingsSection } from "../auth/auth";
import { AssistantsSection } from "../assistants/assistants";
import { CliInstallSection } from "../cli-install/cli-install";
import { DeveloperNotificationSection } from "../notifications/notification-window";
import { LaunchAtLoginSection } from "../launch-at-login/launch-at-login";
import {
  SetupWizard,
  useWizardStatusQuery,
} from "../setup-wizard/setup-wizard";
import { DesktopFrame, DesktopLoadingState } from "./ui";

export function DesktopWindow() {
  const wizardStatusQuery = useWizardStatusQuery();

  if (wizardStatusQuery.isPending) {
    return <DesktopLoadingState text={`Loading ${APP_DISPLAY_NAME}...`} />;
  }

  if (wizardStatusQuery.isError) {
    return <DesktopLoadingState text={toErrorMessageText(wizardStatusQuery.error)} />;
  }

  const wizardStatus = wizardStatusQuery.data;
  if (!wizardStatus) {
    return <DesktopLoadingState text={`Loading ${APP_DISPLAY_NAME}...`} />;
  }

  const showingWizard = !wizardStatus.wizard_completed;

  return (
    <>
      <Toaster closeButton position="top-right" richColors visibleToasts={1} />
      <DesktopFrame
        title={showingWizard ? "Installation wizard" : "Settings"}
        description={
          showingWizard
            ? "Authenticate, choose assistant integrations, install the CLI, and decide whether Everr should start in the background when you log in."
            : "Manage your desktop connection, assistant integrations, and launch behavior from one panel."
        }
        headerAction={!showingWizard ? <AccountHeaderAction /> : undefined}
      >
        {showingWizard ? <SetupWizard /> : <SettingsScreen />}
      </DesktopFrame>
    </>
  );
}

function SettingsScreen() {
  return (
    <div className="grid divide-y divide-white/[0.06]">
      <div className="pt-0">
        <AuthSettingsSection />
      </div>
      <AssistantsSection />
      <CliInstallSection />
      <LaunchAtLoginSection />
      {import.meta.env.DEV && (
        <>
          <Separator className="bg-[var(--settings-border-soft)]" />
          <DeveloperNotificationSection />
        </>
      )}
    </div>
  );
}
