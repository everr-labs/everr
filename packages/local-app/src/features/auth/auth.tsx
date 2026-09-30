import { Badge } from "@everr/ui/components/badge";
import { Button } from "@everr/ui/components/button";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { invokeCommand, toErrorMessageText } from "../../lib/local-api";
import {
  FeatureErrorText,
  FeatureLoadingText,
  SettingsSection,
} from "../app-shell/ui";

const userProfileQueryKey = ["local-app", "user-profile"] as const;
const orgQueryKey = ["local-app", "org"] as const;

type AuthStatus = {
  status: "signed_in" | "signed_out";
  session_path: string;
};

type UserProfileResponse = {
  email: string;
  name: string;
  profile_url: string | null;
};

type OrgResponse = {
  name: string;
};

type PendingSignIn = {
  status: "pending";
  user_code: string;
  verification_url: string;
  expires_at: string;
  poll_interval_seconds: number;
};

type SignInResponse =
  | PendingSignIn
  | {
      status: "signed_in";
      session_path: string;
    }
  | {
      status: "denied" | "expired";
    };

const authStatusQueryKey = ["local-app", "auth-status"] as const;
const pendingSignInQueryKey = ["local-app", "pending-sign-in"] as const;

function getAuthStatus() {
  return invokeCommand<AuthStatus>("get_auth_status");
}

function getPendingSignIn() {
  return invokeCommand<PendingSignIn | null>("get_pending_sign_in");
}

function startSignIn() {
  return invokeCommand<SignInResponse>("start_sign_in");
}

function pollSignIn() {
  return invokeCommand<SignInResponse>("poll_sign_in");
}

function openSignInBrowser() {
  return invokeCommand<void>("open_sign_in_browser");
}

function signOut() {
  return invokeCommand<AuthStatus>("sign_out");
}

function getUserProfile() {
  return invokeCommand<UserProfileResponse | null>("get_user_profile");
}

function getOrg() {
  return invokeCommand<OrgResponse | null>("get_org");
}

function isPendingSignIn(
  value: SignInResponse | PendingSignIn | null | undefined,
): value is PendingSignIn {
  return value?.status === "pending";
}

function formatCodeForDisplay(code: string): string {
  return code.toUpperCase().split("").join(" ");
}

function formatRemainingTime(expiresAt: string, now: number): string {
  const remainingMs = Math.max(new Date(expiresAt).getTime() - now, 0);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function useNow(tickMs = 1_000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, tickMs);

    return () => window.clearInterval(id);
  }, [tickMs]);

  return now;
}

function clearAccountCache(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: userProfileQueryKey });
  queryClient.removeQueries({ queryKey: orgQueryKey });
}

export function useAuthStatusQuery() {
  return useQuery({
    queryKey: authStatusQueryKey,
    queryFn: getAuthStatus,
  });
}

export function useUserProfileQuery(enabled = true) {
  return useQuery({
    queryKey: userProfileQueryKey,
    queryFn: getUserProfile,
    enabled,
  });
}

export function useOrgQuery(enabled = true) {
  return useQuery({
    queryKey: orgQueryKey,
    queryFn: getOrg,
    enabled,
  });
}

function usePendingSignInQuery(enabled: boolean) {
  return useQuery({
    queryKey: pendingSignInQueryKey,
    queryFn: getPendingSignIn,
    enabled,
  });
}

export function useSignInMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: startSignIn,
    onSuccess(data) {
      if (isPendingSignIn(data)) {
        queryClient.setQueryData(pendingSignInQueryKey, data);
        return;
      }

      if (data.status === "signed_in") {
        clearAccountCache(queryClient);
        queryClient.setQueryData(authStatusQueryKey, data);
        queryClient.setQueryData(pendingSignInQueryKey, null);
        toast.success("Signed in.");
        return;
      }

      queryClient.setQueryData(pendingSignInQueryKey, null);
      toast.error(
        data.status === "expired"
          ? "The sign-in code expired. Refresh it to try again."
          : "The sign-in request was denied.",
      );
    },
    onError(error) {
      toast.error(toErrorMessageText(error));
    },
  });
}

function useOpenSignInBrowserMutation() {
  return useMutation({
    mutationFn: openSignInBrowser,
    onError(error) {
      toast.error(toErrorMessageText(error));
    },
  });
}

export function useSignOutMutation() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: signOut,
    onSuccess(data) {
      clearAccountCache(queryClient);
      queryClient.setQueryData(authStatusQueryKey, data);
      queryClient.setQueryData(pendingSignInQueryKey, null);
      toast.success("Logged out.");
      void navigate({ to: "/logs" });
    },
    onError(error) {
      toast.error(toErrorMessageText(error));
    },
  });
}

function AuthContent() {
  const title = "Authenticate your Everr account";
  const description =
    "Connect the CLI to Everr Cloud or complete a pending sign-in.";
  const queryClient = useQueryClient();
  const authStatusQuery = useAuthStatusQuery();
  const signInMutation = useSignInMutation();
  const openBrowserMutation = useOpenSignInBrowserMutation();
  const signedIn = authStatusQuery.data?.status === "signed_in";
  const pendingQuery = usePendingSignInQuery(
    !signedIn && !authStatusQuery.isPending,
  );
  const pendingSignIn = pendingQuery.data;
  const now = useNow();
  const expiresAtMs = pendingSignIn
    ? new Date(pendingSignIn.expires_at).getTime()
    : 0;
  const isExpired = Boolean(pendingSignIn) && now >= expiresAtMs;

  const pollQuery = useQuery({
    queryKey: [
      ...pendingSignInQueryKey,
      "poll",
      pendingSignIn?.user_code ?? "idle",
    ] as const,
    queryFn: pollSignIn,
    enabled: Boolean(pendingSignIn) && !isExpired,
    refetchInterval: pendingSignIn
      ? Math.max(pendingSignIn.poll_interval_seconds, 1) * 1_000
      : false,
    retry: false,
  });

  useEffect(() => {
    if (!pollQuery.data) {
      return;
    }

    if (isPendingSignIn(pollQuery.data)) {
      queryClient.setQueryData(pendingSignInQueryKey, pollQuery.data);
      return;
    }

    if (pollQuery.data.status === "signed_in") {
      clearAccountCache(queryClient);
      queryClient.setQueryData(authStatusQueryKey, pollQuery.data);
      queryClient.setQueryData(pendingSignInQueryKey, null);
      toast.success("Signed in.");
      return;
    }

    if (pollQuery.data.status === "denied") {
      queryClient.setQueryData(pendingSignInQueryKey, null);
      toast.error("The sign-in request was denied.");
      return;
    }

    toast.error("The sign-in code expired. Refresh it to try again.");
  }, [pollQuery.data, queryClient]);

  const pendingError = pendingQuery.error ?? pollQuery.error;
  const showAction = signedIn || !pendingSignIn || isExpired;
  const action = showAction ? (
    <Button
      size="lg"
      disabled={
        authStatusQuery.isPending ||
        signInMutation.isPending ||
        authStatusQuery.isError
      }
      onClick={() => void signInMutation.mutateAsync()}
    >
      {signInMutation.isPending
        ? pendingSignIn
          ? "Refreshing..."
          : "Preparing code..."
        : signedIn
          ? "Re-authenticate"
          : pendingSignIn && isExpired
            ? "Refresh code"
            : "Sign in"}
    </Button>
  ) : undefined;
  const content = authStatusQuery.isPending ? (
    <FeatureLoadingText text="Loading account connection..." />
  ) : authStatusQuery.isError ? (
    <FeatureErrorText
      message={toErrorMessageText(authStatusQuery.error)}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void authStatusQuery.refetch()}
        >
          Retry
        </Button>
      }
    />
  ) : signedIn ? (
    <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
      The CLI is connected to Everr Cloud.
    </p>
  ) : pendingError ? (
    <FeatureErrorText
      message={toErrorMessageText(pendingError)}
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void pendingQuery.refetch()}
        >
          Retry
        </Button>
      }
    />
  ) : pendingSignIn ? (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="m-0 text-[0.72rem] font-semibold uppercase tracking-[0.18em] text-[var(--settings-text-soft)]">
          Device code
        </p>
        <p className="m-0 text-[28px] font-semibold tracking-[0.18em] text-[var(--settings-text)]">
          {formatCodeForDisplay(pendingSignIn.user_code)}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={isExpired || openBrowserMutation.isPending}
          onClick={() => void openBrowserMutation.mutateAsync()}
        >
          {openBrowserMutation.isPending ? "Opening..." : "Open browser"}
        </Button>
        <Badge variant="outline">
          {isExpired
            ? "Expired"
            : `Valid for ${formatRemainingTime(pendingSignIn.expires_at, now)}`}
        </Badge>
        {isExpired ? (
          <Button
            variant="outline"
            size="sm"
            disabled={signInMutation.isPending}
            onClick={() => void signInMutation.mutateAsync()}
          >
            {signInMutation.isPending ? "Refreshing..." : "Refresh code"}
          </Button>
        ) : null}
      </div>

      <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
        {isExpired
          ? "This code expired before it was approved. Refresh it to generate a new one."
          : "Open the browser when you’re ready, approve the matching code there, and this window will complete sign-in automatically."}
      </p>
    </div>
  ) : (
    <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
      Generate a device code here, then open the browser manually to approve it.
    </p>
  );

  return (
    <SettingsSection title={title} description={description} action={action}>
      {content}
    </SettingsSection>
  );
}

export function AuthSettingsSection() {
  const authStatusQuery = useAuthStatusQuery();

  if (authStatusQuery.isPending || authStatusQuery.isError) {
    return null;
  }

  if (authStatusQuery.data?.status === "signed_in") {
    return null;
  }

  return <AuthContent />;
}
