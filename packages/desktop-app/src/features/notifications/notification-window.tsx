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
import { SettingsSection } from "../desktop-shell/ui";

const AUTO_DISMISS_MS = 40_000;

export type FailureNotification = {
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
  auto_fix_prompt?: string;
};

type TestNotificationResponse = {
  status: "shown" | "queued";
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

export function DeveloperNotificationSection() {
  const triggerNotificationMutation = useTriggerTestNotificationMutation();

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
      description="Preview the notification surface without waiting for a failed pipeline."
      compact
      action={
        <Button
          variant="outline"
          size="sm"
          className="min-w-[136px] max-[620px]:w-full"
          disabled={triggerNotificationMutation.isPending}
          onClick={() => void handleTriggerNotification()}
        >
          {triggerNotificationMutation.isPending ? "Triggering..." : "Test notification"}
        </Button>
      }
    />
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
  }, [notification.dedupe_key]);

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

  const absoluteTime = formatNotificationAbsoluteTime(notification.failure_time);
  const relativeTime = formatNotificationRelativeTime(notification.failure_time);
  const failureScope = formatFailureScope(notification);
  const copyAutoFixPromptLabel = copyMutation.isPending
    ? "Copying..."
    : copiedAutoFixPrompt
      ? "Copied"
      : "Copy auto-fix prompt";

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
            <p className="m-0 text-[0.58rem] font-medium uppercase tracking-[0.06em] text-[#b0b0b0]">
              Everr - Failed run
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
              disabled={busy}
              onClick={() => void openMutation.mutateAsync()}
            >
              {openMutation.isPending ? "Opening..." : "Open run"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 min-w-0 whitespace-nowrap rounded-[10px] border-[#dcdcdc] bg-white px-3.5 text-[0.72rem] font-semibold text-[#4b4b4b] hover:bg-[#f7f7f7] hover:text-[#4b4b4b]"
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
                  Copy auto-fix prompt
                </span>
                <span className="col-start-1 row-start-1">{copyAutoFixPromptLabel}</span>
              </span>
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

function NotificationLoadingState() {
  return <main className="h-screen bg-white" />;
}

function NotificationErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="h-screen bg-white">
      <section className="notificationCard grid h-full items-center bg-white px-[18px] py-4">
        <div className="grid min-w-0 gap-3">
          <div className="grid min-w-0 gap-1">
            <p className="m-0 text-[0.58rem] font-medium uppercase tracking-[0.06em] text-[#b0b0b0]">
              Everr
            </p>
            <h1 className="m-0 text-[0.8rem] font-semibold text-[#121212]">
              Failed to load notification
            </h1>
            <p className="m-0 text-[0.68rem] leading-[1.35] text-[#767676]">
              The active failed pipeline could not be fetched.
            </p>
          </div>
          <div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-[10px] border-[#dcdcdc] bg-white px-3.5 text-[0.72rem] font-semibold text-[#4b4b4b] hover:bg-[#f7f7f7]"
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
