import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  invokeCommand,
  SETTINGS_CHANGED_EVENT,
  toErrorMessageText,
} from "@/lib/tauri";
import { useInvalidateOnTauriEvent } from "../../lib/tauri-events";
import { useAuthStatusQuery } from "../auth/auth";
import {
  FeatureErrorText,
  FeatureLoadingText,
  SettingsSection,
} from "../desktop-shell/ui";
import { notificationEmailsQueryKey } from "./query-keys";

export type UserProfile = {
  email: string;
  name: string;
  profile_url: string | null;
};

function getNotificationEmails() {
  return invokeCommand<string[]>("get_notification_emails");
}

function setNotificationEmails(emails: string[]) {
  return invokeCommand<void>("set_notification_emails", { emails });
}

export function NotificationEmailsSection() {
  const authStatusQuery = useAuthStatusQuery();
  const queryClient = useQueryClient();
  const [newEmail, setNewEmail] = useState("");
  const signedIn = authStatusQuery.data?.status === "signed_in";

  useInvalidateOnTauriEvent(SETTINGS_CHANGED_EVENT, (qc) => {
    void qc.invalidateQueries({ queryKey: notificationEmailsQueryKey });
  });

  const emailsQuery = useQuery({
    queryKey: notificationEmailsQueryKey,
    queryFn: getNotificationEmails,
    enabled: signedIn,
  });

  const mutation = useMutation({
    mutationFn: setNotificationEmails,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationEmailsQueryKey });
    },
    onError: (error) => {
      toast.error(toErrorMessageText(error));
    },
  });

  if (authStatusQuery.isPending || authStatusQuery.isError || !signedIn) {
    return null;
  }

  if (emailsQuery.isPending) {
    return (
      <SettingsSection
        title="Notifications"
        description="These emails are used to detect which updates are related to you, we never send them to our servers because the logic is applied locally."
      >
        <FeatureLoadingText text="Loading notification settings..." />
      </SettingsSection>
    );
  }

  if (emailsQuery.isError) {
    return (
      <SettingsSection
        title="Notifications"
        description="These emails are used to detect which updates are related to you, we never send them to our servers because the logic is applied locally."
      >
        <FeatureErrorText message="Failed to load notification settings." />
      </SettingsSection>
    );
  }

  const emails = emailsQuery.data ?? [];

  function addEmail() {
    const trimmed = newEmail.trim();
    if (!trimmed || emails.includes(trimmed)) return;
    mutation.mutate([...emails, trimmed]);
    setNewEmail("");
  }

  function removeEmail(email: string) {
    mutation.mutate(emails.filter((e) => e !== email));
  }

  return (
    <SettingsSection
      title="Notifications"
      description="These emails are used to detect which updates are related to you, we never send them to our servers because the logic is applied locally."
    >
      <div className="flex flex-col gap-1 mb-3">
        {emails.map((email) => (
          <div
            key={email}
            className="flex items-center justify-between text-sm"
          >
            <span className="text-[var(--settings-text)]">{email}</span>
            <button
              type="button"
              onClick={() => removeEmail(email)}
              disabled={mutation.isPending}
              className="text-[var(--settings-text-muted)] hover:text-[var(--settings-text)] text-xs disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addEmail()}
          placeholder="Add email"
          disabled={mutation.isPending}
          className="flex-1 text-sm bg-transparent border border-[var(--settings-border-soft)] rounded px-2 py-1 text-[var(--settings-text)] disabled:opacity-40"
        />
        <button
          type="button"
          onClick={addEmail}
          disabled={!newEmail.trim() || mutation.isPending}
          className="text-sm px-3 py-1 rounded border border-[var(--settings-border-soft)] text-[var(--settings-text)] disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </SettingsSection>
  );
}
