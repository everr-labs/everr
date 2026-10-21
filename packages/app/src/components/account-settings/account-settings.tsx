import { RetryError } from "@everr/ui/components/retry-error";
import { Skeleton } from "@everr/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { GoogleConnection } from "#app/components/account-settings/google-connection.tsx";
import { PasswordSettings } from "#app/components/account-settings/password-settings.tsx";
import { ProfileSettings } from "#app/components/account-settings/profile-settings.tsx";
import { linkedAccountsQueryOptions } from "#app/components/account-settings/queries.ts";
import { SessionsSettings } from "#app/components/account-settings/sessions-settings.tsx";
import { PageHeader } from "#app/components/page-header.tsx";
import { authClient } from "#app/lib/auth-client.ts";

export interface AccountSettingsProps {
  googleSignInEnabled: boolean;
  children: ReactNode;
}

export function AccountSettings({ googleSignInEnabled, children }: AccountSettingsProps) {
  const { data: session } = authClient.useSession();
  const accounts = useQuery(linkedAccountsQueryOptions(session?.user.id ?? ""));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
      <PageHeader title="Account Settings" lede="Manage your profile and account lifecycle." />

      {session?.user && (
        <>
          <ProfileSettings key={session.user.id} user={session.user} />
          {accounts.isPending && <Skeleton className="h-40" aria-label="Loading sign-in methods" />}
          {accounts.isError && (
            <RetryError
              variant="inline"
              title="Could not load sign-in methods"
              message={accounts.error.message}
              onRetry={() => void accounts.refetch()}
            />
          )}
          {accounts.data && (
            <>
              <PasswordSettings
                key={session.user.id}
                hasPassword={accounts.data.some((account) => account.providerId === "credential")}
              />
              {googleSignInEnabled && (
                <GoogleConnection
                  linked={accounts.data.some((account) => account.providerId === "google")}
                />
              )}
            </>
          )}
          <SessionsSettings
            key={session.session.id}
            userId={session.user.id}
            currentSessionId={session.session.id}
          />
        </>
      )}

      {children}
    </div>
  );
}
