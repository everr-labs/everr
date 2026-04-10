import { Button } from "@everr/ui/components/button";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { GithubInstallStep } from "@/components/github-install-step";
import { OnboardingLayout } from "@/components/onboarding-layout";
import { ensureOrganizationForDevice } from "@/data/onboarding";
import { workOS } from "@/lib/workos";

export const Route = createFileRoute("/cli/device")({
  validateSearch: z.object({
    code: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({
    code: search.code,
  }),
  loader: async ({ location, deps }) => {
    const auth = await getAuth();

    if (!auth.user) {
      const signInUrl = await getSignInUrl({ data: location.href });
      throw redirect({ href: signInUrl });
    }

    const hasOrg = !!auth.organizationId;

    const [orgName] = await Promise.all([
      hasOrg
        ? workOS.organizations
            .getOrganization(auth.organizationId!)
            .then((org) => org.name)
            .catch(() => null)
        : Promise.resolve(null),
    ]);

    const firstName = auth.user.firstName ?? auth.user.email.split("@")[0];

    return {
      deviceCode: deps.code?.toUpperCase() ?? "",
      hasOrg,
      userName: firstName,
      orgName,
    };
  },
  component: CliDeviceApprovalPage,
});

function formatCodeForDisplay(code: string): string {
  return code.toUpperCase().split("").join(" ");
}

function CliDeviceApprovalPage() {
  const { deviceCode, hasOrg, userName, orgName } = Route.useLoaderData();

  if (!hasOrg) {
    return <NewUserDeviceFlow deviceCode={deviceCode} />;
  }

  return (
    <ExistingUserDeviceFlow
      deviceCode={deviceCode}
      userName={userName}
      orgName={orgName}
    />
  );
}

type NewUserStep = "setup" | "github" | "approving" | "done" | "error";

function NewUserDeviceFlow({ deviceCode }: { deviceCode: string }) {
  const [step, setStep] = useState<NewUserStep>("setup");
  const [githubInstalled, setGithubInstalled] = useState(false);

  useEffect(() => {
    if (step !== "setup") return;
    ensureOrganizationForDevice()
      .then(() => setStep("github"))
      .catch(() => setStep("error"));
  }, [step]);

  async function handleGithubDone() {
    setStep("approving");
    try {
      const res = await fetch("/api/cli/auth/device/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_code: deviceCode, action: "approve" }),
      });
      setStep(res.ok ? "done" : "error");
    } catch {
      setStep("error");
    }
  }

  return (
    <OnboardingLayout title="Setting up Everr" label="Setting up">
      {step === "setup" && (
        <div className="flex flex-col items-center gap-4 py-8">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-center text-sm text-muted-foreground">
            Setting up your workspace&hellip;
          </p>
        </div>
      )}

      {step === "github" && (
        <GithubInstallStep
          installed={githubInstalled}
          onInstalled={() => setGithubInstalled(true)}
          onContinue={() => void handleGithubDone()}
          onSkip={() => void handleGithubDone()}
        />
      )}

      {step === "approving" && (
        <div className="flex flex-col items-center gap-4 py-8">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="text-center text-sm text-muted-foreground">
            Activating CLI access&hellip;
          </p>
        </div>
      )}

      {step === "done" && (
        <div className="py-12 text-center">
          <p className="text-2xl font-semibold">You're all set</p>
          <p className="mt-3 text-base text-muted-foreground">
            Return to your terminal to continue.
          </p>
        </div>
      )}

      {step === "error" && (
        <div className="py-12 text-center">
          <p className="text-2xl font-semibold text-destructive">
            Something went wrong
          </p>
          <p className="mt-3 text-base text-muted-foreground">
            Restart <code className="font-mono">everr setup</code> and try
            again.
          </p>
        </div>
      )}
    </OnboardingLayout>
  );
}

function ExistingUserDeviceFlow({
  deviceCode,
  userName,
  orgName,
}: {
  deviceCode: string;
  userName: string;
  orgName: string | null;
}) {
  const [status, setStatus] = useState<
    "idle" | "approved" | "denied" | "error"
  >("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(action: "approve" | "deny") {
    if (!deviceCode) {
      setStatus("error");
      return;
    }

    setIsSubmitting(true);
    const response = await fetch("/api/cli/auth/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_code: deviceCode, action }),
    });
    setIsSubmitting(false);

    if (!response.ok) {
      setStatus("error");
      return;
    }

    setStatus(action === "approve" ? "approved" : "denied");
  }

  return (
    <main className="bg-muted/20 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <h1 className="text-center text-4xl font-semibold tracking-tight">
          Device activation
        </h1>
        <p className="text-muted-foreground mt-3 text-center text-base">
          {orgName ? `${userName} · ${orgName}` : userName}
        </p>

        <section className="bg-background mt-10 rounded-2xl border px-6 py-10 sm:px-12">
          {status === "idle" || status === "error" ? (
            <>
              <p className="text-center text-[32px] leading-none font-semibold uppercase sm:text-[56px]">
                {deviceCode
                  ? formatCodeForDisplay(deviceCode)
                  : "M I S S I N G  C O D E"}
              </p>
              <p className="text-muted-foreground mt-6 text-center text-base">
                Confirm this code is shown on your device
              </p>

              <div className="mt-10 grid grid-cols-2 gap-4">
                <Button
                  variant="outline"
                  size="lg"
                  disabled={isSubmitting}
                  onClick={() => void submit("deny")}
                >
                  Deny
                </Button>
                <Button
                  size="lg"
                  disabled={isSubmitting}
                  onClick={() => void submit("approve")}
                >
                  Confirm
                </Button>
              </div>

              {status === "error" ? (
                <p className="mt-4 text-center text-sm text-red-400">
                  Invalid or expired code. Restart{" "}
                  <code className="font-mono">everr setup</code> from your
                  terminal.
                </p>
              ) : null}
            </>
          ) : null}

          {status === "approved" ? (
            <div className="py-12 text-center">
              <p className="text-2xl font-semibold">Device approved</p>
              <p className="text-muted-foreground mt-3 text-base">
                You can return to your terminal.
              </p>
            </div>
          ) : null}

          {status === "denied" ? (
            <div className="py-12 text-center">
              <p className="text-2xl font-semibold">Request denied</p>
              <p className="text-muted-foreground mt-3 text-base">
                The sign-in request was denied. You can close this page.
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
