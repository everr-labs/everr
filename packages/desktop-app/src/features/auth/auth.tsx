import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  FeatureErrorText,
  FeatureLoadingText,
  WizardStepSection,
} from "../desktop-shell/ui";
import {
  AUTH_CHANGED_EVENT,
  invokeCommand,
  toErrorMessageText,
} from "../../lib/tauri";
import { useInvalidateOnTauriEvent } from "../../lib/tauri-events";

export type AuthStatus = {
  status: "signed_in" | "signed_out";
  session_path: string;
};

export const authStatusQueryKey = ["desktop-app", "auth-status"] as const;

function getAuthStatus() {
  return invokeCommand<AuthStatus>("get_auth_status");
}

function startSignIn() {
  return invokeCommand<AuthStatus>("start_sign_in");
}

function signOut() {
  return invokeCommand<AuthStatus>("sign_out");
}

export function useAuthStatusQuery() {
  useInvalidateOnTauriEvent(AUTH_CHANGED_EVENT, (queryClient) => {
    void queryClient.invalidateQueries({ queryKey: authStatusQueryKey });
  });

  return useQuery({
    queryKey: authStatusQueryKey,
    queryFn: getAuthStatus,
  });
}

export function useSignInMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: startSignIn,
    onSuccess(data) {
      queryClient.setQueryData(authStatusQueryKey, data);
      toast.success("Signed in.");
    },
    onError(error) {
      toast.error(toErrorMessageText(error));
    },
  });
}

export function useSignOutMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: signOut,
    onSuccess(data) {
      queryClient.setQueryData(authStatusQueryKey, data);
      toast.success("Logged out.");
    },
    onError(error) {
      toast.error(toErrorMessageText(error));
    },
  });
}

export function AccountHeaderAction() {
  const authStatusQuery = useAuthStatusQuery();
  const signInMutation = useSignInMutation();
  const signOutMutation = useSignOutMutation();
  const busy = signInMutation.isPending || signOutMutation.isPending;
  const signedIn = authStatusQuery.data?.status === "signed_in";

  return (
    <Button
      variant={signedIn ? "outline" : "default"}
      size="sm"
      disabled={busy || authStatusQuery.isPending || authStatusQuery.isError}
      onClick={() => void (signedIn ? signOutMutation.mutateAsync() : signInMutation.mutateAsync())}
    >
      {signedIn
        ? signOutMutation.isPending
          ? "Logging out..."
          : "Logout"
        : signInMutation.isPending
          ? "Signing in..."
          : "Sign in"}
    </Button>
  );
}

export function AuthWizardStep() {
  const authStatusQuery = useAuthStatusQuery();
  const signInMutation = useSignInMutation();
  const signedIn = authStatusQuery.data?.status === "signed_in";

  return (
    <WizardStepSection
      title="Authenticate your Everr account"
      description="Use the device flow to link this tray app to the account that should receive CI failure notifications."
      badge={<Badge variant="outline">{signedIn ? "Connected" : "Required"}</Badge>}
      action={
        <Button
          className="min-w-[132px]"
          disabled={authStatusQuery.isPending || signInMutation.isPending || authStatusQuery.isError}
          onClick={() => void signInMutation.mutateAsync()}
        >
          {signInMutation.isPending
            ? "Signing in..."
            : signedIn
              ? "Re-authenticate"
              : "Sign in"}
        </Button>
      }
    >
      {authStatusQuery.isPending ? (
        <FeatureLoadingText text="Loading account connection..." />
      ) : authStatusQuery.isError ? (
        <FeatureErrorText
          message={toErrorMessageText(authStatusQuery.error)}
          action={
            <Button variant="outline" size="sm" onClick={() => void authStatusQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <p className="m-0 text-sm leading-6 text-[var(--settings-text-muted)]">
          The browser will open the Everr verification page and return here when the device flow
          completes.
        </p>
      )}
    </WizardStepSection>
  );
}
