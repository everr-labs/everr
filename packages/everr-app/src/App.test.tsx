import { emit } from "@tauri-apps/api/event";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

const NOTIFICATION_CHANGED_EVENT = "everr://notification-changed";
const NOTIFICATION_AUTO_DISMISS_MS = 2 * 60_000;

type AssistantKind = "codex" | "claude" | "cursor";

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

type AssistantStatus = {
  assistant: AssistantKind;
  detected: boolean;
  configured: boolean;
  path: string;
};

type SetupStatus = {
  auth_status: {
    status: "signed_in" | "signed_out";
    session_path: string;
  };
  cli_status: {
    status: "installed" | "not_installed";
    install_path: string;
  };
  wizard_state: {
    wizard_completed: boolean;
    assistant_step_seen: boolean;
    launch_at_login_step_seen: boolean;
    selected_assistants: AssistantKind[];
  };
  assistant_statuses: AssistantStatus[];
  launch_at_login_enabled: boolean;
};

type TestNotificationResponse = {
  status: "shown" | "queued";
};

type RenderMainOptions = {
  signedIn?: boolean;
  cliInstalled?: boolean;
  wizardCompleted?: boolean;
  assistantStepSeen?: boolean;
  launchStepSeen?: boolean;
  selectedAssistants?: AssistantKind[];
  launchAtLoginEnabled?: boolean;
  assistantStatuses?: AssistantStatus[];
  testNotification?: TestNotificationResponse;
};

function createNotification(overrides: Partial<FailureNotification> = {}): FailureNotification {
  return {
    dedupe_key: "one",
    trace_id: "trace-one",
    repo: "everr-labs/everr",
    branch: "feature/granola",
    workflow_name: "CI",
    failure_time: "2026-03-07T13:32:00Z",
    details_url: "https://example.com/dashboard/runs/trace-one/jobs/job-one/steps/3",
    job_name: "test",
    step_number: "3",
    step_name: "Run suite",
    ...overrides,
  };
}

function defaultAssistantStatuses(): AssistantStatus[] {
  return [
    {
      assistant: "codex",
      detected: true,
      configured: false,
      path: "/tmp/.codex/AGENTS.md",
    },
    {
      assistant: "claude",
      detected: false,
      configured: false,
      path: "/tmp/.claude/CLAUDE.md",
    },
    {
      assistant: "cursor",
      detected: true,
      configured: false,
      path: "/tmp/.cursor/rules/everr.mdc",
    },
  ];
}

function createSetupStatus({
  signedIn = true,
  cliInstalled = true,
  wizardCompleted = true,
  assistantStepSeen = true,
  launchStepSeen = true,
  selectedAssistants = [],
  launchAtLoginEnabled = false,
  assistantStatuses = defaultAssistantStatuses(),
}: RenderMainOptions = {}): SetupStatus {
  return {
    auth_status: {
      status: signedIn ? "signed_in" : "signed_out",
      session_path: "/tmp/everr/session.json",
    },
    cli_status: {
      status: cliInstalled ? "installed" : "not_installed",
      install_path: "/tmp/everr/bin/everr",
    },
    wizard_state: {
      wizard_completed: wizardCompleted,
      assistant_step_seen: assistantStepSeen,
      launch_at_login_step_seen: launchStepSeen,
      selected_assistants: selectedAssistants,
    },
    assistant_statuses: assistantStatuses,
    launch_at_login_enabled: launchAtLoginEnabled,
  };
}

function renderNotificationApp(initialNotification = createNotification()) {
  let activeNotification: FailureNotification | null = initialNotification;
  const dismissSpy = vi.fn(() => {
    activeNotification = null;
    return null;
  });
  const openSpy = vi.fn(() => {
    activeNotification = null;
    return null;
  });
  const copySpy = vi.fn(() => null);

  mockWindows("notification");
  mockIPC(
    (cmd) => {
      switch (cmd) {
        case "get_active_notification":
          return activeNotification;
        case "dismiss_active_notification":
          return dismissSpy();
        case "open_notification_target":
          return openSpy();
        case "copy_notification_auto_fix_prompt":
          return copySpy();
        default:
          throw new Error(`Unexpected IPC command: ${cmd}`);
      }
    },
    { shouldMockEvents: true },
  );

  render(<App />);

  return {
    dismissSpy,
    openSpy,
    copySpy,
    setNotification(nextNotification: FailureNotification | null) {
      activeNotification = nextNotification;
    },
  };
}

function renderMainApp(options: RenderMainOptions = {}) {
  let setupStatus = createSetupStatus(options);
  const triggerTestNotificationSpy = vi.fn(
    () => options.testNotification ?? { status: "shown" },
  );

  mockWindows("main");
  mockIPC(
    (cmd, args) => {
      const payload = (args ?? {}) as {
        assistants?: AssistantKind[];
        enabled?: boolean;
        step?: "assistants" | "launch_at_login";
      };

      switch (cmd) {
        case "get_setup_status":
          return setupStatus;
        case "start_sign_in":
          setupStatus = {
            ...setupStatus,
            auth_status: {
              ...setupStatus.auth_status,
              status: "signed_in",
            },
          };
          return setupStatus.auth_status;
        case "sign_out":
          setupStatus = {
            ...setupStatus,
            auth_status: {
              ...setupStatus.auth_status,
              status: "signed_out",
            },
          };
          return setupStatus.auth_status;
        case "install_cli":
          setupStatus = {
            ...setupStatus,
            cli_status: {
              ...setupStatus.cli_status,
              status: "installed",
            },
          };
          return setupStatus.cli_status;
        case "configure_assistants": {
          const selected = payload.assistants ?? [];
          setupStatus = {
            ...setupStatus,
            wizard_state: {
              ...setupStatus.wizard_state,
              assistant_step_seen: true,
              selected_assistants: selected,
            },
            assistant_statuses: setupStatus.assistant_statuses.map((status) => ({
              ...status,
              configured: selected.includes(status.assistant),
            })),
          };
          return setupStatus;
        }
        case "mark_optional_setup_step_seen":
          setupStatus = {
            ...setupStatus,
            wizard_state: {
              ...setupStatus.wizard_state,
              assistant_step_seen:
                payload.step === "assistants"
                  ? true
                  : setupStatus.wizard_state.assistant_step_seen,
              launch_at_login_step_seen:
                payload.step === "launch_at_login"
                  ? true
                  : setupStatus.wizard_state.launch_at_login_step_seen,
            },
          };
          return setupStatus;
        case "set_launch_at_login":
          setupStatus = {
            ...setupStatus,
            launch_at_login_enabled: Boolean(payload.enabled),
            wizard_state: {
              ...setupStatus.wizard_state,
              launch_at_login_step_seen: true,
            },
          };
          return setupStatus;
        case "complete_setup_wizard":
          setupStatus = {
            ...setupStatus,
            wizard_state: {
              ...setupStatus.wizard_state,
              wizard_completed: true,
              assistant_step_seen: true,
              launch_at_login_step_seen: true,
            },
          };
          return setupStatus;
        case "trigger_test_notification":
          return triggerTestNotificationSpy();
        default:
          throw new Error(`Unexpected IPC command: ${cmd}`);
      }
    },
    { shouldMockEvents: true },
  );

  render(<App />);

  return {
    triggerTestNotificationSpy,
    getSetupStatus: () => setupStatus,
  };
}

async function flushNotificationRender() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("desktop window", () => {
  it("renders the settings view for completed users", async () => {
    renderMainApp();

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Base URL")).not.toBeInTheDocument();
    expect(screen.queryByText("Authenticate your Everr account")).not.toBeInTheDocument();
    expect(screen.getByText("Background tasks")).toBeInTheDocument();
  });

  it("renders the first-run wizard for incomplete setup", async () => {
    renderMainApp({
      signedIn: false,
      cliInstalled: false,
      wizardCompleted: false,
      assistantStepSeen: false,
      launchStepSeen: false,
    });

    expect(
      await screen.findByRole("heading", { name: "Installation wizard" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Authenticate your Everr account")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("does not preselect assistants on the assistant step", async () => {
    renderMainApp({
      signedIn: true,
      cliInstalled: false,
      wizardCompleted: false,
      assistantStepSeen: false,
      launchStepSeen: false,
      assistantStatuses: defaultAssistantStatuses(),
    });

    expect(await screen.findByText("Select assistants to integrate")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /codex/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /cursor/i })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /claude/i })).not.toBeChecked();
  });

  it("advances from authentication to assistant selection after sign in", async () => {
    renderMainApp({
      signedIn: false,
      cliInstalled: false,
      wizardCompleted: false,
      assistantStepSeen: false,
      launchStepSeen: false,
    });

    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Select assistants to integrate")).toBeInTheDocument();
  });

  it("saves assistant choices and advances to CLI installation", async () => {
    renderMainApp({
      signedIn: true,
      cliInstalled: false,
      wizardCompleted: false,
      assistantStepSeen: false,
      launchStepSeen: false,
    });

    await screen.findByText("Select assistants to integrate");
    fireEvent.click(screen.getByRole("checkbox", { name: /claude/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save choices" }));

    expect(await screen.findByText("Install the Everr CLI")).toBeInTheDocument();
  });

  it("keeps all assistants deselected after saving an empty selection", async () => {
    renderMainApp({
      selectedAssistants: ["codex", "cursor"],
      assistantStepSeen: true,
      assistantStatuses: defaultAssistantStatuses().map((status) => ({
        ...status,
        configured: status.assistant === "codex" || status.assistant === "cursor",
      })),
    });

    const codex = await screen.findByRole("checkbox", { name: /codex/i });
    const cursor = screen.getByRole("checkbox", { name: /cursor/i });

    fireEvent.click(codex);
    fireEvent.click(cursor);
    fireEvent.click(screen.getByRole("button", { name: "Save integrations" }));

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /codex/i })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: /cursor/i })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: /claude/i })).not.toBeChecked();
    });
  });

  it("advances from CLI installation to launch-at-login setup", async () => {
    renderMainApp({
      signedIn: true,
      cliInstalled: false,
      wizardCompleted: false,
      assistantStepSeen: true,
      launchStepSeen: false,
    });

    fireEvent.click(await screen.findByRole("button", { name: "Install CLI" }));

    expect(await screen.findByText("Enable background startup")).toBeInTheDocument();
  });

  it("supports skipping launch at login and finishing the wizard", async () => {
    renderMainApp({
      signedIn: true,
      cliInstalled: true,
      wizardCompleted: false,
      assistantStepSeen: true,
      launchStepSeen: false,
    });

    await screen.findByText("Enable background startup");
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finish" }));

    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(await screen.findByText("Setup complete.")).toBeInTheDocument();
  });

  it("triggers a test notification from the settings view", async () => {
    const { triggerTestNotificationSpy } = renderMainApp({
      testNotification: { status: "queued" },
    });

    fireEvent.click(await screen.findByRole("button", { name: "Test notification" }));

    await waitFor(() => {
      expect(triggerTestNotificationSpy).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText("Test notification queued behind the active notification."),
    ).toBeInTheDocument();
  });
});

describe("notification window", () => {
  it("renders the active notification with local absolute and relative time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-07T13:35:00Z"));

    renderNotificationApp();
    await flushNotificationRender();

    expect(screen.getByText("CI")).toBeInTheDocument();
    expect(screen.getByText("everr-labs/everr")).toBeInTheDocument();
    expect(screen.getByText("feature/granola")).toBeInTheDocument();
    expect(screen.getByText("test • Step 3: Run suite")).toBeInTheDocument();
    expect(screen.getByText("3m ago")).toBeInTheDocument();
    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it("dismisses the active notification", async () => {
    const { dismissSpy } = renderNotificationApp();

    await screen.findByText("CI");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(dismissSpy).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("No active notifications")).toBeInTheDocument();
  });

  it("opens the run target and advances the queue", async () => {
    const { openSpy } = renderNotificationApp();

    await screen.findByText("CI");
    fireEvent.click(screen.getByRole("button", { name: "Open run" }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("No active notifications")).toBeInTheDocument();
  });

  it("copies the auto-fix prompt without dismissing the notification", async () => {
    const { copySpy } = renderNotificationApp();

    await screen.findByText("CI");
    fireEvent.click(screen.getByRole("button", { name: "Copy auto-fix prompt" }));

    await waitFor(() => {
      expect(copySpy).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("CI")).toBeInTheDocument();
  });

  it("does not auto-dismiss before two minutes", async () => {
    vi.useFakeTimers();

    const { dismissSpy } = renderNotificationApp();
    await flushNotificationRender();
    expect(screen.getByText("CI")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(NOTIFICATION_AUTO_DISMISS_MS - 1_000);
    await flushNotificationRender();

    expect(dismissSpy).not.toHaveBeenCalled();
    expect(screen.getByText("CI")).toBeInTheDocument();
  });

  it("auto-dismisses after two minutes", async () => {
    vi.useFakeTimers();

    const { dismissSpy } = renderNotificationApp();
    await flushNotificationRender();
    expect(screen.getByText("CI")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(NOTIFICATION_AUTO_DISMISS_MS);
    await flushNotificationRender();

    expect(dismissSpy).toHaveBeenCalledTimes(1);
  });

  it("pauses the dismiss countdown while hovered", async () => {
    vi.useFakeTimers();

    const { dismissSpy } = renderNotificationApp();
    await flushNotificationRender();
    const card = screen.getByText("CI");

    fireEvent.mouseEnter(card.closest(".notificationCard") as HTMLElement);
    await vi.advanceTimersByTimeAsync(NOTIFICATION_AUTO_DISMISS_MS);
    expect(dismissSpy).not.toHaveBeenCalled();

    fireEvent.mouseLeave(card.closest(".notificationCard") as HTMLElement);
    await vi.advanceTimersByTimeAsync(NOTIFICATION_AUTO_DISMISS_MS);
    await flushNotificationRender();

    expect(dismissSpy).toHaveBeenCalledTimes(1);
  });

  it("refreshes when the backend emits a notification-changed event", async () => {
    const harness = renderNotificationApp();
    await screen.findByText("CI");

    harness.setNotification(
      createNotification({
        dedupe_key: "two",
        trace_id: "trace-two",
        workflow_name: "Nightly",
      }),
    );
    await emit(NOTIFICATION_CHANGED_EVENT);

    expect(await screen.findByText("Nightly")).toBeInTheDocument();
  });
});
