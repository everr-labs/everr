import { Button } from "@everr/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Clipboard, ExternalLink } from "lucide-react";
import { useState } from "react";
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

function copyHistoryAutoFixPrompt(dedupeKey: string) {
  return invokeCommand<void>("copy_history_auto_fix_prompt", {
    dedupeKey,
  });
}

function openHistoryNotification(dedupeKey: string) {
  return invokeCommand<void>("open_history_notification", {
    dedupeKey,
  });
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
      <div className="flex items-start justify-between gap-4 px-5 pb-4">
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
        <div className="px-5 py-4">
          <p className="m-0 text-sm text-[var(--settings-text-muted)]">
            Loading notifications...
          </p>
        </div>
      ) : entries.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <p className="m-0 text-sm text-[var(--settings-text-muted)]">
            No notifications yet. Failed CI runs will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[0.78rem]">
            <thead>
              <tr className="border-b border-white/[0.06] text-[0.7rem] font-medium uppercase tracking-wider text-[var(--settings-text-muted)]">
                <th className="w-8 py-2 pl-5 pr-1 font-medium" />
                <th className="py-2 px-2 font-medium">Workflow</th>
                <th className="py-2 px-2 font-medium">Repository</th>
                <th className="py-2 px-2 font-medium">Branch</th>
                <th className="py-2 px-2 font-medium">When</th>
                <th className="w-16 py-2 pl-2 pr-5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <NotificationRow
                  key={entry.notification.dedupeKey + entry.receivedAt}
                  entry={entry}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NotificationRow({ entry }: { entry: HistoryEntry }) {
  const { notification, seen } = entry;
  const relativeTime = formatNotificationRelativeTime(notification.failedAt);
  const [copied, setCopied] = useState(false);

  const copyMutation = useMutation({
    mutationFn: () => copyHistoryAutoFixPrompt(notification.dedupeKey),
    onSuccess() {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
  });

  const openMutation = useMutation({
    mutationFn: () => openHistoryNotification(notification.dedupeKey),
  });

  return (
    <tr className="border-b border-white/[0.04] transition-colors hover:bg-white/[0.03]">
      <td className="py-2 pl-5 pr-1">
        {!seen ? (
          <span className="block size-2 rounded-full bg-red-500" />
        ) : (
          <span className="block size-2" />
        )}
      </td>
      <td className="py-2 px-2 font-medium text-[var(--settings-text)]">
        {notification.workflowName}
      </td>
      <td className="py-2 px-2 text-[var(--settings-text-muted)]">
        {notification.repo}
      </td>
      <td className="py-2 px-2">
        <span className="inline-block rounded bg-white/[0.06] px-1.5 py-0.5 text-[0.72rem] text-[var(--settings-text-muted)]">
          {notification.branch}
        </span>
      </td>
      <td className="py-2 px-2 text-[var(--settings-text-muted)]">
        {relativeTime}
      </td>
      <td className="py-2 pl-2 pr-5">
        <TooltipProvider>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger
                className="flex size-7 cursor-pointer items-center justify-center rounded text-[var(--settings-text-muted)] transition-colors hover:bg-white/[0.08] hover:text-[var(--settings-text)] disabled:pointer-events-none disabled:opacity-50"
                disabled={copyMutation.isPending}
                onClick={() => void copyMutation.mutateAsync()}
              >
                <span className="relative grid size-3.5 place-items-center">
                  <Clipboard
                    className={`col-start-1 row-start-1 size-3.5 transition-all duration-200 ${copied ? "scale-0 opacity-0" : "scale-100 opacity-100"}`}
                  />
                  <Check
                    className={`col-start-1 row-start-1 size-3.5 text-emerald-400 transition-all duration-200 ${copied ? "scale-100 opacity-100" : "scale-0 opacity-0"}`}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {copied ? "Copied!" : "Copy auto-fix prompt"}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                className="flex size-7 cursor-pointer items-center justify-center rounded text-[var(--settings-text-muted)] transition-colors hover:bg-white/[0.08] hover:text-[var(--settings-text)] disabled:pointer-events-none disabled:opacity-50"
                disabled={openMutation.isPending}
                onClick={() => void openMutation.mutateAsync()}
              >
                <ExternalLink className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top">Open in browser</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </td>
    </tr>
  );
}
