import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@everr/ui/components/tooltip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
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
  const [emailError, setEmailError] = useState("");
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
        title="Notification emails"
        description="Emails used to match CI events to you."
      >
        <FeatureLoadingText text="Loading notification settings..." />
      </SettingsSection>
    );
  }

  if (emailsQuery.isError) {
    return (
      <SettingsSection
        title="Notification emails"
        description="Emails used to match CI events to you."
      >
        <FeatureErrorText message="Failed to load notification settings." />
      </SettingsSection>
    );
  }

  const emails = emailsQuery.data ?? [];

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function addEmail() {
    const trimmed = newEmail.trim();
    if (!trimmed) return;
    if (!EMAIL_REGEX.test(trimmed)) {
      setEmailError("Please enter a valid email address.");
      return;
    }
    if (emails.includes(trimmed)) {
      setEmailError("This email is already added.");
      return;
    }
    setEmailError("");
    mutation.mutate([...emails, trimmed]);
    setNewEmail("");
  }

  function removeEmail(email: string) {
    mutation.mutate(emails.filter((e) => e !== email));
  }

  return (
    <SettingsSection
      title="Notification emails"
      description="Emails used to match CI events to you."
    >
      {emails.length > 0 && (
        <TooltipProvider>
          <div className="flex flex-wrap gap-1.5">
            {emails.map((email) => (
              <Badge
                key={email}
                variant="outline"
                className="gap-1.5 pl-2.5 pr-1 py-1 text-[0.75rem]"
              >
                {email}
                <Tooltip>
                  <TooltipTrigger
                    className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-white/[0.1] hover:text-foreground disabled:pointer-events-none"
                    disabled={mutation.isPending}
                    onClick={() => removeEmail(email)}
                  >
                    <X className="size-3" />
                  </TooltipTrigger>
                  <TooltipContent side="top">Remove</TooltipContent>
                </Tooltip>
              </Badge>
            ))}
          </div>
        </TooltipProvider>
      )}

      <div className="grid gap-1.5">
        <div className="flex gap-2">
          <Input
            type="email"
            value={newEmail}
            onChange={(e) => {
              setNewEmail(e.target.value);
              setEmailError("");
            }}
            onKeyDown={(e) => e.key === "Enter" && addEmail()}
            placeholder="Add email address"
            disabled={mutation.isPending}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!newEmail.trim() || mutation.isPending}
            onClick={addEmail}
          >
            <Plus className="size-3.5" />
            Add
          </Button>
        </div>
        {emailError && (
          <p className="text-[0.78rem] text-red-400">{emailError}</p>
        )}
      </div>
    </SettingsSection>
  );
}
