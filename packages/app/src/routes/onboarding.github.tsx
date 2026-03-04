import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { getGithubAppInstallStatus } from "@/data/onboarding";

export const Route = createFileRoute("/onboarding/github")({
  loader: async () => {
    const auth = await getAuth();

    if (!auth.user) {
      const signInUrl = await getSignInUrl({ data: "/onboarding/github" });
      throw redirect({ href: signInUrl });
    }

    if (!auth.organizationId) {
      throw redirect({ to: "/onboarding/organization" });
    }

    const githubStatus = await getGithubAppInstallStatus();
    const installedOnGithub = Array.isArray(githubStatus)
      ? githubStatus.some((installation) => installation.status === "active")
      : Boolean(
          (githubStatus as { installed?: boolean } | null | undefined)
            ?.installed,
        );

    if (installedOnGithub) {
      throw redirect({ to: "/onboarding/cli" });
    }
  },
  component: OnboardingGithubStep,
});

function OnboardingGithubStep() {
  const navigate = useNavigate();

  return (
    <main className="bg-muted/20 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full border bg-background text-lg font-semibold">
          2
        </div>
        <h1 className="mt-6 text-center text-4xl font-semibold tracking-tight">
          Connect GitHub
        </h1>

        <section className="bg-background mt-10 rounded-2xl border px-6 py-8 sm:px-12">
          <h2 className="text-2xl font-semibold">
            Install the Everr GitHub App
          </h2>
          <p className="text-muted-foreground mt-2 text-base">
            Install to sync workflow runs and logs from your repositories.
          </p>

          <div className="mt-8 space-y-4">
            <a
              href="/api/github/install/start"
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto"
            >
              Install GitHub App
            </a>
          </div>

          <div className="mt-8 flex items-center justify-between">
            <Button
              type="button"
              size="lg"
              onClick={() => void navigate({ to: "/dashboard" })}
            >
              Skip for now
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
