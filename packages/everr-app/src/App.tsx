import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "./components/ui/card";
import { Separator } from "./components/ui/separator";
import { Toaster } from "./components/ui/sonner";
import { cn } from "./lib/utils";
import {
  formatNotificationAbsoluteTime,
  formatNotificationRelativeTime,
} from "./notification-time";

const AUTO_DISMISS_MS = 40_000;
const NOTIFICATION_CHANGED_EVENT = "everr://notification-changed";
const NOTIFICATION_WINDOW_LABEL = "notification";
const SETTINGS_CHANGED_EVENT = "everr://settings-changed";
const AUTH_CHANGED_EVENT = "everr://auth-changed";
const SETTINGS_TOAST_ID = "settings-feedback";

const WIZARD_STEPS = [
  {
    id: "authenticate",
    label: "Authenticate",
    eyebrow: "Step 1",
  },
  {
    id: "assistants",
    label: "Assistants",
    eyebrow: "Step 2",
  },
  {
    id: "cli",
    label: "Install CLI",
    eyebrow: "Step 3",
  },
  {
    id: "launch",
    label: "Launch at login",
    eyebrow: "Step 4",
  },
] as const;

type AssistantKind = "codex" | "claude" | "cursor";
type BusyAction =
  | "signin"
  | "install"
  | "logout"
  | "notify"
  | "assistants"
  | "launch"
  | "finish"
  | null;

type AuthStatus = {
  status: "signed_in" | "signed_out";
  session_path: string;
};

type CliInstallStatus = {
  status: "installed" | "not_installed";
  install_path: string;
};

type WizardState = {
  wizard_completed: boolean;
  assistant_step_seen: boolean;
  launch_at_login_step_seen: boolean;
  selected_assistants: AssistantKind[];
};

type AssistantStatus = {
  assistant: AssistantKind;
  detected: boolean;
  configured: boolean;
  path: string;
};

type SetupStatus = {
  auth_status: AuthStatus;
  cli_status: CliInstallStatus;
  wizard_state: WizardState;
  assistant_statuses: AssistantStatus[];
  launch_at_login_enabled: boolean;
};

type OptionalSetupStep = "assistants" | "launch_at_login";

type TestNotificationResponse = {
  status: "shown" | "queued";
};

type FailureNotification = {
  dedupe_key: string;
  trace_id: string;
  repo: string;
  branch: string;
  workflow_name: string;
  failure_time: string;
  details_url: string;
  job_name?: string;
  step_number?: string;
  step_name?: string;
};

function App() {
  const [windowLabel] = useState(resolveWindowLabel);

  useEffect(() => {
    document.documentElement.dataset.window = windowLabel;
    document.body.dataset.window = windowLabel;

    return () => {
      delete document.documentElement.dataset.window;
      delete document.body.dataset.window;
    };
  }, [windowLabel]);

  if (windowLabel === NOTIFICATION_WINDOW_LABEL) {
    return <NotificationApp />;
  }

  return <DesktopApp />;
}

function DesktopApp() {
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [assistantSelection, setAssistantSelection] = useState<AssistantKind[]>([]);
  const [assistantDraftDirty, setAssistantDraftDirty] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [busy, setBusy] = useState<BusyAction>(null);

  const signedIn = setupStatus?.auth_status.status === "signed_in";
  const cliInstalled = setupStatus?.cli_status.status === "installed";
  const showingWizard = setupStatus ? !setupStatus.wizard_state.wizard_completed : false;

  function showSuccessToast(text: string) {
    toast.success(text, { id: SETTINGS_TOAST_ID });
  }

  function showErrorToast(error: unknown) {
    toast.error(toErrorMessageText(error), { id: SETTINGS_TOAST_ID });
  }

  function syncSetupStatus(next: SetupStatus, preserveAssistantDraft = false) {
    setSetupStatus(next);
    setWizardStep(resolveWizardStepIndex(next));
    setAssistantSelection((current) =>
      preserveAssistantDraft ? current : defaultAssistantSelection(next),
    );
  }

  async function refresh(preserveAssistantDraft = assistantDraftDirty) {
    const next = await invoke<SetupStatus>("get_setup_status");
    syncSetupStatus(next, preserveAssistantDraft);
  }

  useEffect(() => {
    void refresh(false);
  }, []);

  useEffect(() => {
    const appWindow = safeGetCurrentWindow();
    if (!appWindow) {
      return;
    }

    let unlistenSettings: (() => void) | undefined;
    let unlistenAuth: (() => void) | undefined;

    void appWindow
      .listen(SETTINGS_CHANGED_EVENT, () => {
        void refresh(false);
      })
      .then((cleanup) => {
        unlistenSettings = cleanup;
      });

    void appWindow
      .listen(AUTH_CHANGED_EVENT, () => {
        void refresh(false);
      })
      .then((cleanup) => {
        unlistenAuth = cleanup;
      });

    return () => {
      unlistenSettings?.();
      unlistenAuth?.();
    };
  }, [assistantDraftDirty]);

  async function signIn() {
    setBusy("signin");
    try {
      await invoke("start_sign_in");
      await refresh(false);
      showSuccessToast("Signed in.");
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusy(null);
    }
  }

  async function installCli() {
    setBusy("install");
    try {
      await invoke("install_cli");
      await refresh(false);
      showSuccessToast("CLI installed.");
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    setBusy("logout");
    try {
      await invoke("sign_out");
      await refresh(false);
      showSuccessToast("Logged out.");
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusy(null);
    }
  }

  async function saveAssistants() {
    setBusy("assistants");
    try {
      const next = await invoke<SetupStatus>("configure_assistants", {
        assistants: assistantSelection,
      });
      setAssistantDraftDirty(false);
      syncSetupStatus(next);
      showSuccessToast(
        assistantSelection.length > 0
          ? "Assistant integrations updated."
          : "Assistant integrations cleared.",
      );
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusy(null);
    }
  }

  async function updateLaunchAtLogin(enabled: boolean) {
    setBusy("launch");
    try {
      const next = await invoke<SetupStatus>("set_launch_at_login", { enabled });
      syncSetupStatus(next, assistantDraftDirty);
      showSuccessToast(
        enabled ? "Launch at login enabled." : "Launch at login disabled.",
      );
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusy(null);
    }
  }

  async function markOptionalStepSeen(step: OptionalSetupStep) {
    const next = await invoke<SetupStatus>("mark_optional_setup_step_seen", {
      step,
    });
    syncSetupStatus(next, assistantDraftDirty);
  }

  async function finishWizard() {
    setBusy("finish");
    try {
      if (
        setupStatus &&
        !setupStatus.wizard_state.launch_at_login_step_seen
      ) {
        await markOptionalStepSeen("launch_at_login");
      }
      const next = await invoke<SetupStatus>("complete_setup_wizard");
      syncSetupStatus(next, assistantDraftDirty);
      showSuccessToast("Setup complete.");
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusy(null);
    }
  }

  async function advanceWizard() {
    if (!setupStatus) {
      return;
    }

    if (wizardStep === 1 && !setupStatus.wizard_state.assistant_step_seen) {
      await markOptionalStepSeen("assistants");
      return;
    }

    if (wizardStep === 3) {
      await finishWizard();
      return;
    }

    setWizardStep((current) => Math.min(current + 1, WIZARD_STEPS.length - 1));
  }

  async function skipOptionalWizardStep(step: OptionalSetupStep) {
    setBusy(step === "assistants" ? "assistants" : "launch");
    try {
      await markOptionalStepSeen(step);
      showSuccessToast(
        step === "assistants"
          ? "Skipped assistant setup for now."
          : "Skipped launch at login for now.",
      );
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusy(null);
    }
  }

  async function triggerTestNotification() {
    setBusy("notify");
    try {
      const result = await invoke<TestNotificationResponse>("trigger_test_notification");
      showSuccessToast(
        result.status === "shown"
          ? "Test notification displayed."
          : "Test notification queued behind the active notification.",
      );
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusy(null);
    }
  }

  if (!setupStatus) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_30%),linear-gradient(180deg,var(--settings-shell)_0%,var(--settings-shell-bottom)_100%)] text-[var(--settings-text)]">
        <section className="flex min-h-screen items-center justify-center px-6 py-14">
          <Card className="w-full max-w-[420px] border-[color:var(--settings-border)] bg-[var(--settings-panel)] text-[var(--settings-text)] shadow-[var(--settings-panel-shadow)]">
            <CardContent className="grid place-items-center px-6 py-12">
              <p className="m-0 text-sm text-[var(--settings-text-muted)]">
                Loading Everr App...
              </p>
            </CardContent>
          </Card>
        </section>
      </main>
    );
  }

  return (
    <>
      <Toaster closeButton position="top-right" richColors visibleToasts={1} />
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_30%),linear-gradient(180deg,var(--settings-shell)_0%,var(--settings-shell-bottom)_100%)] text-[var(--settings-text)]">
        <Card className="w-full max-w-[860px] overflow-hidden border-[color:var(--settings-border)] bg-[var(--settings-panel)] text-[var(--settings-text)] shadow-[var(--settings-panel-shadow)]">
          <CardHeader
            className="gap-5 border-b border-[color:var(--settings-border-soft)] px-6 pb-6 pt-8 max-[620px]:px-5"
            data-tauri-drag-region
          >
            <div className="flex items-start justify-between gap-4 max-[720px]:flex-col">
              <div className="grid gap-1.5">
                <p className="m-0 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--settings-text-soft)]">
                  Everr App
                </p>
                <h1 className="m-0 text-[clamp(2rem,5vw,2.8rem)] font-medium leading-none tracking-[-0.04em]">
                  {showingWizard ? "Installation wizard" : "Settings"}
                </h1>
                <CardDescription className="max-w-[52ch] text-[0.95rem] leading-6 text-[var(--settings-text-muted)]">
                  {showingWizard
                    ? "Authenticate, choose assistant integrations, install the CLI, and decide whether Everr should start in the background when you log in."
                    : "Manage your desktop connection, assistant integrations, and launch behavior from one panel."}
                </CardDescription>
              </div>
            </div>
          </CardHeader>

          <CardContent className="grid gap-0 px-0">
            {showingWizard ? (
              <WizardPanel
                assistantSelection={assistantSelection}
                assistantStatuses={setupStatus.assistant_statuses}
                busy={busy}
                cliStatus={setupStatus.cli_status}
                currentStep={wizardStep}
                launchAtLoginEnabled={setupStatus.launch_at_login_enabled}
                onAdvance={advanceWizard}
                onAssistantToggle={(assistant) => {
                  setAssistantDraftDirty(true);
                  setAssistantSelection((current) =>
                    current.includes(assistant)
                      ? current.filter((item) => item !== assistant)
                      : [...current, assistant],
                  );
                }}
                onBack={() => setWizardStep((current) => Math.max(current - 1, 0))}
                onFinish={finishWizard}
                onInstallCli={installCli}
                onSaveAssistants={saveAssistants}
                onSetLaunchAtLogin={updateLaunchAtLogin}
                onSignIn={signIn}
                onSkipAssistants={() => void skipOptionalWizardStep("assistants")}
                onSkipLaunch={() => void skipOptionalWizardStep("launch_at_login")}
                requiredStepsComplete={Boolean(signedIn && cliInstalled)}
                signedIn={Boolean(signedIn)}
              />
            ) : (
              <SettingsPanel
                assistantSelection={assistantSelection}
                assistantStatuses={setupStatus.assistant_statuses}
                busy={busy}
                cliStatus={setupStatus.cli_status}
                launchAtLoginEnabled={setupStatus.launch_at_login_enabled}
                onAssistantToggle={(assistant) => {
                  setAssistantDraftDirty(true);
                  setAssistantSelection((current) =>
                    current.includes(assistant)
                      ? current.filter((item) => item !== assistant)
                      : [...current, assistant],
                  );
                }}
                onInstallCli={installCli}
                onLogout={logout}
                onSaveAssistants={saveAssistants}
                onSetLaunchAtLogin={updateLaunchAtLogin}
                onSignIn={signIn}
                onTriggerTestNotification={triggerTestNotification}
                signedIn={Boolean(signedIn)}
              />
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}

function WizardPanel({
  assistantSelection,
  assistantStatuses,
  busy,
  cliStatus,
  currentStep,
  launchAtLoginEnabled,
  onAdvance,
  onAssistantToggle,
  onBack,
  onFinish,
  onInstallCli,
  onSaveAssistants,
  onSetLaunchAtLogin,
  onSignIn,
  onSkipAssistants,
  onSkipLaunch,
  requiredStepsComplete,
  signedIn,
}: {
  assistantSelection: AssistantKind[];
  assistantStatuses: AssistantStatus[];
  busy: BusyAction;
  cliStatus: CliInstallStatus;
  currentStep: number;
  launchAtLoginEnabled: boolean;
  onAdvance: () => Promise<void>;
  onAssistantToggle: (assistant: AssistantKind) => void;
  onBack: () => void;
  onFinish: () => Promise<void>;
  onInstallCli: () => Promise<void>;
  onSaveAssistants: () => Promise<void>;
  onSetLaunchAtLogin: (enabled: boolean) => Promise<void>;
  onSignIn: () => Promise<void>;
  onSkipAssistants: () => void;
  onSkipLaunch: () => void;
  requiredStepsComplete: boolean;
  signedIn: boolean;
}) {
  const cliInstalled = cliStatus.status === "installed";
  const isLastStep = currentStep === WIZARD_STEPS.length - 1;
  const continueDisabled =
    busy !== null
      || (currentStep === 0 && !signedIn)
      || (currentStep === 2 && !cliInstalled)
      || (isLastStep && !requiredStepsComplete);

  return (
    <div className="grid gap-0">
      <div className="grid gap-6 px-6 py-6 max-[620px]:px-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
          <Card className="border-[color:var(--settings-border-soft)] bg-[var(--settings-panel-strong)]">
            <CardContent className="grid gap-5 px-5 py-5">
              {currentStep === 0 ? (
                <WizardStepSection
                  title="Authenticate your Everr account"
                  description="Use the device flow to link this tray app to the account that should receive CI failure notifications."
                  badge={signedIn ? "Connected" : "Required"}
                  action={
                    <Button
                      className="min-w-[132px]"
                      disabled={busy !== null}
                      onClick={() => void onSignIn()}
                    >
                      {busy === "signin" ? "Signing in..." : signedIn ? "Re-authenticate" : "Sign in"}
                    </Button>
                  }
                >
                  <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
                    The browser will open the Everr verification page and return here when the device flow completes.
                  </p>
                </WizardStepSection>
              ) : null}

              {currentStep === 1 ? (
                <WizardStepSection
                  title="Select assistants to integrate"
                  description="Everr can install managed instructions for the assistants you use locally. These selections are optional and can be changed later."
                  badge="Optional"
                  action={
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className="min-w-[132px]"
                        disabled={busy !== null}
                        onClick={onSkipAssistants}
                      >
                        Skip for now
                      </Button>
                      <Button
                        className="min-w-[132px]"
                        disabled={busy !== null}
                        onClick={() => void onSaveAssistants()}
                      >
                        {busy === "assistants" ? "Saving..." : "Save choices"}
                      </Button>
                    </div>
                  }
                >
                  <AssistantChecklist
                    selection={assistantSelection}
                    statuses={assistantStatuses}
                    onToggle={onAssistantToggle}
                  />
                </WizardStepSection>
              ) : null}

              {currentStep === 2 ? (
                <WizardStepSection
                  title="Install the Everr CLI"
                  description="The desktop app bundles the CLI, installs it into your local bin directory, and keeps it updated automatically when the bundled binary changes."
                  badge={cliInstalled ? "Installed" : "Required"}
                  action={
                    <Button
                      className="min-w-[132px]"
                      disabled={busy !== null || cliInstalled}
                      onClick={() => void onInstallCli()}
                    >
                      {busy === "install" ? "Installing..." : cliInstalled ? "Installed" : "Install CLI"}
                    </Button>
                  }
                >
                  <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
                    Install path: <code>{cliStatus.install_path}</code>
                  </p>
                </WizardStepSection>
              ) : null}

              {currentStep === 3 ? (
                <WizardStepSection
                  title="Enable background startup"
                  description="If you enable launch at login, Everr will start automatically after sign-in so the tray app can keep watching your current repository."
                  badge={launchAtLoginEnabled ? "Enabled" : "Optional"}
                  action={
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        className="min-w-[132px]"
                        disabled={busy !== null}
                        onClick={onSkipLaunch}
                      >
                        Skip for now
                      </Button>
                      <Button
                        className="min-w-[132px]"
                        disabled={busy !== null}
                        onClick={() => void onSetLaunchAtLogin(!launchAtLoginEnabled)}
                      >
                        {busy === "launch"
                          ? "Saving..."
                          : launchAtLoginEnabled
                            ? "Disable"
                            : "Enable"}
                      </Button>
                    </div>
                  }
                >
                  <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
                    On macOS, the system may ask you to approve Everr in Login Items or Background Items after enabling this.
                  </p>
                </WizardStepSection>
              ) : null}
            </CardContent>
          </Card>
         
        </div>
      </div>

      <Separator className="bg-[var(--settings-border-soft)]" />

      <div className="flex items-center justify-between gap-3 px-6 py-5 max-[620px]:flex-col max-[620px]:items-stretch max-[620px]:px-5">
        <Button
          variant="ghost"
          disabled={busy !== null || currentStep === 0}
          onClick={onBack}
        >
          Back
        </Button>

        <div className="flex flex-wrap justify-end gap-2 max-[620px]:w-full">
          <Button
            variant={isLastStep ? "default" : "outline"}
            className="min-w-[132px] max-[620px]:w-full"
            disabled={continueDisabled}
            onClick={() => void (isLastStep ? onFinish() : onAdvance())}
          >
            {busy === "finish" ? "Finishing..." : isLastStep ? "Finish" : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SettingsPanel({
  assistantSelection,
  assistantStatuses,
  busy,
  cliStatus,
  launchAtLoginEnabled,
  onAssistantToggle,
  onInstallCli,
  onLogout,
  onSaveAssistants,
  onSetLaunchAtLogin,
  onSignIn,
  onTriggerTestNotification,
  signedIn,
}: {
  assistantSelection: AssistantKind[];
  assistantStatuses: AssistantStatus[];
  busy: BusyAction;
  cliStatus: CliInstallStatus;
  launchAtLoginEnabled: boolean;
  onAssistantToggle: (assistant: AssistantKind) => void;
  onInstallCli: () => Promise<void>;
  onLogout: () => Promise<void>;
  onSaveAssistants: () => Promise<void>;
  onSetLaunchAtLogin: (enabled: boolean) => Promise<void>;
  onSignIn: () => Promise<void>;
  onTriggerTestNotification: () => Promise<void>;
  signedIn: boolean;
}) {
  const cliInstalled = cliStatus.status === "installed";

  return (
    <div className="grid divide-y divide-white/[0.06]">
      <SettingsSection
        title="Account"
        description={
          signedIn
            ? "This desktop app is connected and ready to poll your failures."
            : "Sign in to connect this desktop app to your Everr account."
        }
        action={
          <Button
            variant={signedIn ? "outline" : "default"}
            className="min-w-[112px] max-[620px]:w-full"
            disabled={busy !== null}
            onClick={() => void (signedIn ? onLogout() : onSignIn())}
          >
            {signedIn
              ? busy === "logout"
                ? "Logging out..."
                : "Logout"
              : busy === "signin"
                ? "Signing in..."
                : "Sign in"}
          </Button>
        }
      />

      <SettingsSection
        title="Assistants"
        description="Manage the Codex, Claude, and Cursor instruction files Everr owns on this machine."
        action={
          <Button
            className="min-w-[132px] max-[620px]:w-full"
            disabled={busy !== null}
            onClick={() => void onSaveAssistants()}
          >
            {busy === "assistants" ? "Saving..." : "Save integrations"}
          </Button>
        }
      >
        <AssistantChecklist
          selection={assistantSelection}
          statuses={assistantStatuses}
          onToggle={onAssistantToggle}
        />
      </SettingsSection>

      <SettingsSection
        title="CLI"
        description="Install the bundled Everr CLI into your local bin directory. Everr will keep it updated automatically after that."
        action={
          <Button
            className="min-w-[132px] max-[620px]:w-full"
            disabled={busy !== null || cliInstalled}
            onClick={() => void onInstallCli()}
          >
            {busy === "install" ? "Installing..." : cliInstalled ? "Installed" : "Install CLI"}
          </Button>
        }
      >
        <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
          Install path: <code>{cliStatus.install_path}</code>
        </p>
      </SettingsSection>

      <SettingsSection
        title="Background tasks"
        description="Control whether Everr should start automatically after you log in."
        action={
          <Button
            className="min-w-[132px] max-[620px]:w-full"
            disabled={busy !== null}
            onClick={() => void onSetLaunchAtLogin(!launchAtLoginEnabled)}
          >
            {busy === "launch"
              ? "Saving..."
              : launchAtLoginEnabled
                ? "Disable"
                : "Enable"}
          </Button>
        }
      >
        <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
          On macOS, the system may show a Login Items or Background Items approval prompt after enabling this.
        </p>
      </SettingsSection>

      {import.meta.env.DEV && (
        <>
          <SettingsSection
            title="Developer"
            description="Preview the notification surface without waiting for a failed pipeline."
            compact
            action={
              <Button
                variant="outline"
                size="sm"
                className="min-w-[136px] max-[620px]:w-full"
                disabled={busy !== null}
                onClick={() => void onTriggerTestNotification()}
              >
                {busy === "notify" ? "Triggering..." : "Test notification"}
              </Button>
            }
          />
        </>
      )}
    </div>
  );
}

function WizardStepSection({
  title,
  description,
  badge,
  action,
  children,
}: {
  title: string;
  description: string;
  badge: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-4 max-[620px]:flex-col">
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-[1.05rem] font-semibold">{title}</h2>
            <Badge variant="outline">{badge}</Badge>
          </div>
          <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
            {description}
          </p>
        </div>

        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      {children}
    </div>
  );
}

function SettingsSection({
  title,
  description,
  action,
  children,
  compact = false,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section
      className={cn(
        "grid gap-4 px-6 py-5 max-[620px]:px-5",
        compact && "gap-3 py-4",
      )}
    >
      <div className="flex items-start justify-between gap-4 max-[620px]:flex-col max-[620px]:items-stretch">
        <div className="grid gap-1.5">
          <h2 className="m-0 text-[1rem] font-semibold">{title}</h2>
          <p className="m-0 max-w-[46ch] text-[0.92rem] leading-6 text-[var(--settings-text-muted)]">
            {description}
          </p>
        </div>

        {action ? <div className="shrink-0 max-[620px]:w-full">{action}</div> : null}
      </div>

      {children}
    </section>
  );
}

function AssistantChecklist({
  selection,
  statuses,
  onToggle,
}: {
  selection: AssistantKind[];
  statuses: AssistantStatus[];
  onToggle: (assistant: AssistantKind) => void;
}) {
  return (
    <div className="grid gap-2">
      {statuses.map((status) => {
        const checked = selection.includes(status.assistant);

        return (
          <label
            key={status.assistant}
            className={cn(
              "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors",
              checked
                ? "border-white/15 bg-white/[0.06]"
                : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]",
            )}
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onToggle(status.assistant)}
              className="h-4 w-4 shrink-0 rounded border-white/20 bg-transparent accent-white"
            />
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="flex items-center gap-2">
                <span className="text-sm font-medium text-[var(--settings-text)]">
                  {assistantLabel(status.assistant)}
                </span>
                <span
                  className={cn(
                    "inline-block size-1.5 rounded-full",
                    status.configured
                      ? "bg-emerald-400"
                      : status.detected
                        ? "bg-amber-400"
                        : "bg-white/20",
                  )}
                />
              </span>
              <span className="text-xs text-[var(--settings-text-muted)]">
                {status.configured
                  ? "Managed by Everr"
                  : status.detected
                    ? "Detected \u2014 ready to configure"
                    : "Not detected"}
              </span>
              <span className="truncate text-[0.68rem] text-[var(--settings-text-soft)]">
                {status.path}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function NotificationApp() {
  const [notification, setNotification] = useState<FailureNotification | null>(null);
  const [busy, setBusy] = useState<"dismiss" | "open" | "copy" | null>(null);
  const [hovered, setHovered] = useState(false);
  const [remainingMs, setRemainingMs] = useState(AUTO_DISMISS_MS);
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);

  async function refreshNotification() {
    try {
      const next = await invoke<FailureNotification | null>("get_active_notification");
      setNotification(next);
    } catch {
      setNotification(null);
    }
  }

  useEffect(() => {
    void refreshNotification();

    const appWindow = safeGetCurrentWindow();
    if (!appWindow) {
      return;
    }

    let unlisten: (() => void) | undefined;
    void appWindow
      .listen(NOTIFICATION_CHANGED_EVENT, () => {
        void refreshNotification();
      })
      .then((cleanup) => {
        unlisten = cleanup;
      });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    setHovered(false);
    if (!notification) {
      setDeadlineAt(null);
      setRemainingMs(AUTO_DISMISS_MS);
      return;
    }

    setRemainingMs(AUTO_DISMISS_MS);
    setDeadlineAt(Date.now() + AUTO_DISMISS_MS);
  }, [notification?.dedupe_key]);

  useEffect(() => {
    if (!notification || hovered || deadlineAt === null) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void handleDismiss();
    }, Math.max(deadlineAt - Date.now(), 0));

    return () => {
      window.clearTimeout(timeout);
    };
  }, [deadlineAt, hovered, notification?.dedupe_key]);

  async function handleDismiss() {
    setBusy("dismiss");
    try {
      await invoke("dismiss_active_notification");
      await refreshNotification();
    } finally {
      setBusy(null);
    }
  }

  async function handleOpenRun() {
    setBusy("open");
    try {
      await invoke("open_notification_target");
      await refreshNotification();
    } finally {
      setBusy(null);
    }
  }

  async function handleCopyAutoFixPrompt() {
    setBusy("copy");
    try {
      await invoke("copy_notification_auto_fix_prompt");
    } finally {
      setBusy(null);
    }
  }

  function pauseAutoDismiss() {
    setHovered(true);
    if (deadlineAt !== null) {
      setRemainingMs(Math.max(deadlineAt - Date.now(), 0));
      setDeadlineAt(null);
    }
  }

  function resumeAutoDismiss() {
    setHovered(false);
    if (notification) {
      setDeadlineAt(Date.now() + remainingMs);
    }
  }

  if (!notification) {
    return (
      <main className="h-screen bg-white">
        <section className="notificationCard grid h-full items-center bg-white px-[18px] py-4">
          <div className="grid min-w-0 gap-1">
            <p className="m-0 text-[0.58rem] font-medium uppercase tracking-[0.06em] text-[#b0b0b0]">
              Everr
            </p>
            <h1 className="m-0 text-[0.8rem] font-semibold text-[#121212]">
              No active notifications
            </h1>
            <p className="m-0 text-[0.68rem] leading-[1.35] text-[#767676]">
              Waiting for the next failed pipeline.
            </p>
          </div>
        </section>
      </main>
    );
  }

  const absoluteTime = formatNotificationAbsoluteTime(notification.failure_time);
  const relativeTime = formatNotificationRelativeTime(notification.failure_time);
  const failureScope = formatFailureScope(notification);

  return (
    <main className="h-screen bg-white">
      <section
        className="notificationCard group relative flex h-full flex-col bg-white"
        onMouseEnter={pauseAutoDismiss}
        onMouseLeave={resumeAutoDismiss}
      >
        <button
          type="button"
          className="absolute right-3 top-3 z-10 flex size-[18px] items-center justify-center rounded-full bg-[#e8e8e8] text-[#888] opacity-0 transition-opacity duration-150 hover:bg-[#ddd] hover:text-[#555] group-hover:opacity-100 disabled:pointer-events-none"
          aria-label="Dismiss"
          disabled={busy !== null}
          onClick={() => void handleDismiss()}
        >
          <svg
            className="size-[8px]"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M2 2 10 10" />
            <path d="M10 2 2 10" />
          </svg>
        </button>

        <div className="flex flex-1 items-center gap-3 px-[18px] py-3">
          <div className="grid min-w-0 flex-1 gap-[3px]">
            <p className="m-0 text-[0.58rem] font-medium uppercase tracking-[0.06em] text-[#b0b0b0]">
              Everr
            </p>
            <h1 className="m-0 text-[0.8rem] font-semibold leading-[1.15] text-[#121212]">
              {notification.workflow_name}
            </h1>
            <p className="m-0 flex min-w-0 items-center gap-1 text-[0.66rem] leading-[1.3] text-[#767676]">
              <span className="truncate">{notification.repo}</span>
              <span className="text-[#b3b3b3]">•</span>
              <span>{notification.branch}</span>
            </p>
            {failureScope ? (
              <p className="m-0 text-[0.66rem] leading-[1.35] text-[#7c7c7c]">{failureScope}</p>
            ) : null}
            <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.64rem] font-medium tracking-[0.01em] text-[#a1a1a1]">
              <span>{absoluteTime}</span>
              <span className="text-[#cccccc]">·</span>
              <span>{relativeTime}</span>
            </p>
          </div>

          <div className="flex min-w-0 shrink-0 flex-col items-stretch gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 min-w-0 whitespace-nowrap rounded-[10px] bg-[#171717] px-3.5 text-[0.72rem] font-semibold text-white hover:bg-black"
              disabled={busy !== null}
              onClick={() => void handleOpenRun()}
            >
              {busy === "open" ? "Opening..." : "Open run"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 min-w-0 whitespace-nowrap rounded-[10px] border-[#dcdcdc] bg-white px-3.5 text-[0.72rem] font-semibold text-[#4b4b4b] hover:bg-[#f7f7f7]"
              disabled={busy !== null}
              onClick={() => void handleCopyAutoFixPrompt()}
            >
              {busy === "copy" ? "Copying..." : "Copy auto-fix prompt"}
            </Button>
          </div>
        </div>

        <div className="h-[3px] w-full shrink-0 bg-[#f0f0f0]">
          <div
            key={notification.dedupe_key}
            className="notification-progress h-full"
            style={{ animationDuration: `${AUTO_DISMISS_MS}ms` }}
            data-paused={hovered || undefined}
          />
        </div>
      </section>
    </main>
  );
}

function resolveWizardStepIndex(setupStatus: SetupStatus): number {
  if (setupStatus.auth_status.status !== "signed_in") {
    return 0;
  }

  if (!setupStatus.wizard_state.assistant_step_seen) {
    return 1;
  }

  if (setupStatus.cli_status.status !== "installed") {
    return 2;
  }

  if (!setupStatus.wizard_state.launch_at_login_step_seen) {
    return 3;
  }

  return 3;
}

function defaultAssistantSelection(setupStatus: SetupStatus): AssistantKind[] {
  return setupStatus.wizard_state.selected_assistants;
}

function assistantLabel(assistant: AssistantKind): string {
  switch (assistant) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude";
    case "cursor":
      return "Cursor";
  }
}

function formatFailureScope(notification: FailureNotification): string | null {
  if (notification.job_name && notification.step_number && notification.step_name) {
    return `${notification.job_name} • Step ${notification.step_number}: ${notification.step_name}`;
  }

  if (notification.job_name && notification.step_name) {
    return `${notification.job_name} • ${notification.step_name}`;
  }

  if (notification.job_name && notification.step_number) {
    return `${notification.job_name} • Step ${notification.step_number}`;
  }

  if (notification.job_name) {
    return `Job: ${notification.job_name}`;
  }

  return null;
}

function toErrorMessageText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function resolveWindowLabel(): string {
  return safeGetCurrentWindow()?.label ?? "main";
}

function safeGetCurrentWindow() {
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

export default App;
