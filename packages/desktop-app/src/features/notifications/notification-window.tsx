import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { invokeCommand, NOTIFICATION_CHANGED_EVENT } from "../../lib/tauri";
import { useInvalidateOnTauriEvent } from "../../lib/tauri-events";
import {
  formatNotificationAbsoluteTime,
  formatNotificationRelativeTime,
} from "../../notification-time";
import { authStatusQueryKey } from "../auth/auth";
import { SettingsSection } from "../desktop-shell/ui";
import { wizardStatusQueryKey } from "../setup-wizard/setup-wizard";

const AUTO_DISMISS_MS = 40_000;

export type FailureNotification = {
  dedupeKey: string;
  traceId: string;
  repo: string;
  branch: string;
  workflowName: string;
  failedAt: string;
  detailsUrl: string;
  jobName?: string;
  stepNumber?: string;
  stepName?: string;
  autoFixPrompt?: string;
};

type TestNotificationResponse = {
  status: "shown" | "queued";
};

type DevResetResponse = {
  auth_status: {
    status: "signed_in" | "signed_out";
    session_path: string;
  };
  wizard_status: {
    wizard_completed: boolean;
  };
};

export const activeNotificationQueryKey = ["desktop-app", "active-notification"] as const;

function getActiveNotification() {
  return invokeCommand<FailureNotification | null>("get_active_notification");
}

function dismissActiveNotification() {
  return invokeCommand<void>("dismiss_active_notification");
}

function openNotificationTarget() {
  return invokeCommand<void>("open_notification_target");
}

function copyNotificationAutoFixPrompt() {
  return invokeCommand<void>("copy_notification_auto_fix_prompt");
}

function triggerTestNotification() {
  return invokeCommand<TestNotificationResponse>("trigger_test_notification");
}

function resetDevOnboarding() {
  return invokeCommand<DevResetResponse>("reset_dev_onboarding");
}

function useActiveNotificationQuery() {
  useInvalidateOnTauriEvent(NOTIFICATION_CHANGED_EVENT, (queryClient) => {
    void queryClient.invalidateQueries({ queryKey: activeNotificationQueryKey });
  });

  return useQuery({
    queryKey: activeNotificationQueryKey,
    queryFn: getActiveNotification,
  });
}

function useDismissActiveNotificationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: dismissActiveNotification,
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: activeNotificationQueryKey });
    },
  });
}

function useOpenNotificationTargetMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: openNotificationTarget,
    onSuccess() {
      void queryClient.invalidateQueries({ queryKey: activeNotificationQueryKey });
    },
  });
}

function useCopyAutoFixPromptMutation() {
  return useMutation({
    mutationFn: copyNotificationAutoFixPrompt,
  });
}

function useTriggerTestNotificationMutation() {
  return useMutation({
    mutationFn: triggerTestNotification,
  });
}

function useResetDevOnboardingMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: resetDevOnboarding,
    onSuccess(data) {
      queryClient.setQueryData(authStatusQueryKey, data.auth_status);
      queryClient.setQueryData(wizardStatusQueryKey, data.wizard_status);
      toast.success("Developer session reset.");
    },
  });
}

export function DeveloperNotificationSection() {
  const triggerNotificationMutation = useTriggerTestNotificationMutation();
  const resetOnboardingMutation = useResetDevOnboardingMutation();

  async function handleTriggerNotification() {
    const result = await triggerNotificationMutation.mutateAsync();
    toast.success(
      result.status === "shown"
        ? "Test notification displayed."
        : "Test notification queued behind the active notification.",
    );
  }

  return (
    <SettingsSection
      title="Developer"
      description="Preview the notification surface and reset the local dev app state."
      compact
    >
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="min-w-[136px] max-[620px]:w-full"
          disabled={triggerNotificationMutation.isPending}
          onClick={() => void handleTriggerNotification()}
        >
          {triggerNotificationMutation.isPending ? "Triggering..." : "Test notification"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-w-[136px] max-[620px]:w-full"
          disabled={resetOnboardingMutation.isPending}
          onClick={() => void resetOnboardingMutation.mutateAsync()}
        >
          {resetOnboardingMutation.isPending ? "Resetting..." : "Reset onboarding"}
        </Button>
      </div>
    </SettingsSection>
  );
}

export function NotificationWindow() {
  const notificationQuery = useActiveNotificationQuery();

  if (notificationQuery.isPending) {
    return <NotificationLoadingState />;
  }

  if (notificationQuery.isError) {
    return <NotificationErrorState onRetry={() => void notificationQuery.refetch()} />;
  }

  if (!notificationQuery.data) {
    return null;
  }

  return <NotificationCard notification={notificationQuery.data} />;
}

export function NotificationCard({ notification }: { notification: FailureNotification }) {
  const dismissMutation = useDismissActiveNotificationMutation();
  const openMutation = useOpenNotificationTargetMutation();
  const copyMutation = useCopyAutoFixPromptMutation();
  const [copiedAutoFixPrompt, setCopiedAutoFixPrompt] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [remainingMs, setRemainingMs] = useState(AUTO_DISMISS_MS);
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  const busy = dismissMutation.isPending || openMutation.isPending || copyMutation.isPending;

  useEffect(() => {
    setHovered(false);
    setCopiedAutoFixPrompt(false);
    setRemainingMs(AUTO_DISMISS_MS);
    setDeadlineAt(Date.now() + AUTO_DISMISS_MS);
  }, [notification.dedupeKey]);

  useEffect(() => {
    if (hovered || deadlineAt === null) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void dismissMutation.mutateAsync();
    }, Math.max(deadlineAt - Date.now(), 0));

    return () => {
      window.clearTimeout(timeout);
    };
  }, [deadlineAt, dismissMutation, hovered]);

  function pauseAutoDismiss() {
    setHovered(true);
    if (deadlineAt !== null) {
      setRemainingMs(Math.max(deadlineAt - Date.now(), 0));
      setDeadlineAt(null);
    }
  }

  function resumeAutoDismiss() {
    setHovered(false);
    setDeadlineAt(Date.now() + remainingMs);
  }

  const absoluteTime = formatNotificationAbsoluteTime(notification.failedAt);
  const relativeTime = formatNotificationRelativeTime(notification.failedAt);
  const failureScope = formatFailureScope(notification);
  const copyAutoFixPromptLabel = copyMutation.isPending
    ? "Copying..."
    : copiedAutoFixPrompt
      ? "Copied"
      : "Auto-fix prompt";

  return (
    <main className="h-screen bg-card">
      <section
        className="notificationCard group relative flex h-full flex-col bg-card pl-4"
        onMouseEnter={pauseAutoDismiss}
        onMouseLeave={resumeAutoDismiss}
      >
        <button
          type="button"
          className="absolute left-2 top-2 z-10 flex size-[18px] items-center justify-center rounded-full transition-opacity duration-150 bg-accent text-accent-foreground disabled:pointer-events-none"
          aria-label="Dismiss"
          disabled={busy}
          onClick={() => void dismissMutation.mutateAsync()}
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
            <p className="m-0 text-[0.58rem] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Everr - Failed run
            </p>
            <h1 className="m-0 text-[0.8rem] font-semibold leading-[1.15] text-card-foreground">
              {notification.workflowName}
            </h1>
            <p className="m-0 flex min-w-0 items-center gap-1 text-[0.66rem] leading-[1.3] text-muted-foreground">
              <span className="truncate">{notification.repo}</span>
              <span className="text-border">•</span>
              <span>{notification.branch}</span>
            </p>
            {failureScope ? (
              <p className="m-0 text-[0.66rem] leading-[1.35] text-muted-foreground">{failureScope}</p>
            ) : null}
            <p className="m-0 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.64rem] font-medium tracking-[0.01em] text-muted-foreground/70">
              <span>{absoluteTime}</span>
              <span className="text-border">·</span>
              <span>{relativeTime}</span>
            </p>
          </div>

          <div className="flex min-w-0 shrink-0 flex-col items-stretch gap-2">
            <Button
              size="lg"
              className="min-w-0 px-3.5 text-[0.72rem] cursor-pointer"
              disabled={busy}
              onClick={() =>
                void copyMutation.mutateAsync(undefined, {
                  onSuccess() {
                    setCopiedAutoFixPrompt(true);
                  },
                })
              }
            >
              <span className="grid">
                <span aria-hidden="true" className="invisible col-start-1 row-start-1">
                  Auto-fix prompt
                </span>
                <span className="col-start-1 row-start-1">{copyAutoFixPromptLabel}</span>
              </span>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="min-w-0 px-3.5 text-[0.72rem] cursor-pointer"
              disabled={busy}
              onClick={() => void openMutation.mutateAsync()}
            >
              {openMutation.isPending ? "Opening..." : "Open"}
            </Button>
          </div>
        </div>

        <div className="h-[3px] w-full shrink-0 bg-muted">
          <div
            key={notification.dedupeKey}
            className="notification-progress h-full"
            style={{ animationDuration: `${AUTO_DISMISS_MS}ms` }}
            data-paused={hovered || undefined}
          />
        </div>
      </section>
    </main>
  );
}

function NotificationLoadingState() {
  return <main className="h-screen bg-card" />;
}

function NotificationErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="h-screen bg-card">
      <section className="notificationCard grid h-full items-center bg-card px-[18px] py-4">
        <div className="grid min-w-0 gap-3">
          <div className="grid min-w-0 gap-1">
            <p className="m-0 text-[0.58rem] font-medium uppercase tracking-[0.06em] text-muted-foreground">
              Everr
            </p>
            <h1 className="m-0 text-[0.8rem] font-semibold text-card-foreground">
              Failed to load notification
            </h1>
            <p className="m-0 text-[0.68rem] leading-[1.35] text-muted-foreground">
              The active failed pipeline could not be fetched.
            </p>
          </div>
          <div>
            <Button
              variant="outline"
              size="lg"
              className="px-3.5 text-[0.72rem]"
              onClick={() => onRetry()}
            >
              Retry
            </Button>
          </div>
        </div>
      </section>
    </main>
  );
}

function formatFailureScope(notification: FailureNotification): string | null {
  if (notification.jobName && notification.stepNumber && notification.stepName) {
    return `${notification.jobName} • Step ${notification.stepNumber}: ${notification.stepName}`;
  }

  if (notification.jobName && notification.stepName) {
    return `${notification.jobName} • ${notification.stepName}`;
  }

  if (notification.jobName && notification.stepNumber) {
    return `${notification.jobName} • Step ${notification.stepNumber}`;
  }

  if (notification.jobName) {
    return `Job: ${notification.jobName}`;
  }

  return null;
}
