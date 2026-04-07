import { Button } from "@everr/ui/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { invokeCommand, NOTIFICATION_HISTORY_CHANGED_EVENT } from "@/lib/tauri";
import { useInvalidateOnTauriEvent } from "@/lib/tauri-events";
import { formatNotificationRelativeTime } from "../../notification-time";
import type { FailureNotification } from "./notification-window";

type HistoryEntry = {
  notification: FailureNotification;
  seen: boolean;
  receivedAt: string;
};

const notificationHistoryQueryKey = [
  "desktop-app",
  "notification-history",
] as const;

function getNotificationHistory() {
  return invokeCommand<HistoryEntry[]>("get_notification_history");
}

function markAllNotificationsRead() {
  return invokeCommand<void>("mark_all_notifications_read");
}

export function NotificationsPage() {
  useInvalidateOnTauriEvent(
    NOTIFICATION_HISTORY_CHANGED_EVENT,
    (queryClient) => {
      void queryClient.invalidateQueries({
        queryKey: notificationHistoryQueryKey,
      });
    },
  );

  const historyQuery = useQuery({
    queryKey: notificationHistoryQueryKey,
    queryFn: getNotificationHistory,
  });

  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
  });

  const entries = historyQuery.data ?? [];
  const hasUnread = entries.some((e) => !e.seen);

  return (
    <div className="pt-8">
      <div className="flex items-start justify-between gap-4 px-6 pb-4">
        <div className="grid gap-1.5">
          <h1 className="m-0 text-[clamp(1.4rem,3vw,1.8rem)] font-medium leading-none tracking-[-0.04em]">
            Notifications
          </h1>
          <p className="m-0 max-w-[52ch] text-[0.92rem] leading-6 text-[var(--settings-text-muted)]">
            Recent CI pipeline failures.
          </p>
        </div>
        {hasUnread && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={markAllReadMutation.isPending}
            onClick={() => void markAllReadMutation.mutateAsync()}
          >
            Mark all as read
          </Button>
        )}
      </div>

      {historyQuery.isPending ? (
        <div className="px-6 py-4">
          <p className="m-0 text-sm text-[var(--settings-text-muted)]">
            Loading notifications...
          </p>
        </div>
      ) : entries.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <p className="m-0 text-sm text-[var(--settings-text-muted)]">
            No notifications yet. Failed CI runs will appear here.
          </p>
        </div>
      ) : (
        <ul className="m-0 list-none p-0">
          {entries.map((entry) => (
            <NotificationHistoryItem
              key={entry.notification.dedupeKey + entry.receivedAt}
              entry={entry}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationHistoryItem({ entry }: { entry: HistoryEntry }) {
  const { notification, seen } = entry;
  const relativeTime = formatNotificationRelativeTime(notification.failedAt);
  const failureScope = formatFailureScope(notification);

  function handleClick() {
    window.open(notification.detailsUrl, "_blank");
  }

  return (
    <li>
      <button
        type="button"
        className="flex w-full cursor-pointer items-start gap-3 border-b border-white/[0.04] px-6 py-3 text-left transition-colors hover:bg-white/[0.03]"
        onClick={handleClick}
      >
        {!seen && (
          <span className="mt-1.5 block size-2 shrink-0 rounded-full bg-primary" />
        )}
        <div className={`min-w-0 flex-1 grid gap-0.5 ${seen ? "pl-5" : ""}`}>
          <p className="m-0 text-[0.85rem] font-semibold leading-tight text-[var(--settings-text)]">
            {notification.workflowName}
          </p>
          <p className="m-0 flex min-w-0 items-center gap-1 text-[0.78rem] leading-tight text-[var(--settings-text-muted)]">
            <span className="truncate">{notification.repo}</span>
            <span className="text-white/20">&middot;</span>
            <span>{notification.branch}</span>
          </p>
          {failureScope && (
            <p className="m-0 text-[0.75rem] leading-tight text-[var(--settings-text-muted)]">
              {failureScope}
            </p>
          )}
        </div>
        <span className="shrink-0 pt-0.5 text-[0.72rem] text-[var(--settings-text-muted)]">
          {relativeTime}
        </span>
      </button>
    </li>
  );
}

function formatFailureScope(notification: FailureNotification): string | null {
  if (
    notification.jobName &&
    notification.stepNumber &&
    notification.stepName
  ) {
    return `${notification.jobName} \u00b7 Step ${notification.stepNumber}: ${notification.stepName}`;
  }
  if (notification.jobName && notification.stepName) {
    return `${notification.jobName} \u00b7 ${notification.stepName}`;
  }
  if (notification.jobName && notification.stepNumber) {
    return `${notification.jobName} \u00b7 Step ${notification.stepNumber}`;
  }
  if (notification.jobName) {
    return `Job: ${notification.jobName}`;
  }
  return null;
}
