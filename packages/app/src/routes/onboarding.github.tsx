import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

    return { installedOnGithub };
  },
  component: OnboardingGithubStep,
});

function OnboardingGithubStep() {
  const navigate = useNavigate();
  const { installedOnGithub } = Route.useLoaderData();
  const [installed, setInstalled] = useState(installedOnGithub);
  const [tabOpened, setTabOpened] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!tabOpened || installed) return;

    pollingRef.current = setInterval(async () => {
      try {
        const status = await getGithubAppInstallStatus();
        const isInstalled = Array.isArray(status)
          ? status.some((i) => i.status === "active")
          : Boolean(
              (status as { installed?: boolean } | null | undefined)?.installed,
            );
        if (isInstalled) {
          setInstalled(true);
          stopPolling();
        }
      } catch {
        // keep polling
      }
    }, 3000);

    return stopPolling;
  }, [tabOpened, installed, stopPolling]);

  function handleOpenInstall() {
    window.open("/api/github/install/start", "_blank", "noopener");
    setTabOpened(true);
  }

  if (installed) {
    return (
      <main className="bg-muted/20 flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-2xl">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full border border-green-200 bg-green-50 text-green-600 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
            <CheckCircle2 className="size-7" />
          </div>
          <h1 className="mt-6 text-center text-4xl font-semibold tracking-tight">
            GitHub connected
          </h1>
          <p className="text-muted-foreground mt-3 text-center text-base">
            The Everr GitHub App has been installed successfully.
          </p>

          <section className="bg-background mt-10 rounded-2xl border px-6 py-8 sm:px-12">
            <div className="flex items-center justify-center">
              <Button
                type="button"
                size="lg"
                onClick={() => void navigate({ to: "/onboarding/app" })}
              >
                Continue
              </Button>
            </div>
          </section>
        </div>
      </main>
    );
  }

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
            {tabOpened ? (
              <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <Loader2 className="size-4 shrink-0 animate-spin" />
                <span>Waiting for GitHub installation to complete&hellip;</span>
              </div>
            ) : null}
            <Button
              type="button"
              size="lg"
              onClick={handleOpenInstall}
              className="w-full sm:w-auto"
            >
              <ExternalLink className="mr-2 size-4" />
              Install GitHub App
            </Button>
          </div>

          <div className="mt-8 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => void navigate({ to: "/onboarding/app" })}
            >
              Skip for now
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
