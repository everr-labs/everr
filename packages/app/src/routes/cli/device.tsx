import { Button } from "@everr/ui/components/button";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { ArrowRight, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { ensureOrganizationForDevice } from "@/data/onboarding";

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

    return {
      deviceCode: deps.code?.toUpperCase() ?? "",
      hasOrg: !!auth.user && !!auth.organizationId,
    };
  },
  component: CliDeviceApprovalPage,
});

function formatCodeForDisplay(code: string): string {
  return code.toUpperCase().split("").join(" ");
}

function CliDeviceApprovalPage() {
  const { deviceCode, hasOrg } = Route.useLoaderData();

  if (!hasOrg) {
    return <NewUserDeviceFlow deviceCode={deviceCode} />;
  }

  return <ExistingUserDeviceFlow deviceCode={deviceCode} />;
}

type NewUserStep = "setup" | "github" | "approving" | "done" | "error";

function NewUserDeviceFlow({ deviceCode }: { deviceCode: string }) {
  const [step, setStep] = useState<NewUserStep>("setup");

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
    <main className="bg-muted/20 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <h1 className="text-center text-4xl font-semibold tracking-tight">
          Setting up Everr
        </h1>

        <section className="bg-background mt-10 rounded-2xl border px-6 py-10 sm:px-12">
          {step === "setup" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground text-center text-sm">
                Setting up your workspace&hellip;
              </p>
            </div>
          )}

          {step === "github" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">
                  Install the Everr GitHub App
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Sync workflow runs and logs from your repositories. You can
                  skip this and do it later with{" "}
                  <code className="font-mono">everr init</code>.
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  size="lg"
                  onClick={() => {
                    window.open(
                      "/api/github/install/start",
                      "_blank",
                      "noopener",
                    );
                  }}
                >
                  <ExternalLink className="mr-2 size-3.5" />
                  Install GitHub App
                </Button>
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={() => void handleGithubDone()}
                >
                  Skip for now
                </Button>
              </div>
              <div className="border-t border-border pt-6">
                <Button size="lg" onClick={() => void handleGithubDone()}>
                  Continue to terminal
                  <ArrowRight className="ml-2 size-3.5" />
                </Button>
              </div>
            </div>
          )}

          {step === "approving" && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground text-center text-sm">
                Activating CLI access&hellip;
              </p>
            </div>
          )}

          {step === "done" && (
            <div className="py-12 text-center">
              <p className="text-2xl font-semibold">You're all set</p>
              <p className="text-muted-foreground mt-3 text-base">
                Return to your terminal to continue.
              </p>
            </div>
          )}

          {step === "error" && (
            <div className="py-12 text-center">
              <p className="text-2xl font-semibold text-destructive">
                Something went wrong
              </p>
              <p className="text-muted-foreground mt-3 text-base">
                Restart <code className="font-mono">everr onboarding</code> and
                try again.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ExistingUserDeviceFlow({ deviceCode }: { deviceCode: string }) {
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
                  <code className="font-mono">everr onboarding</code> from your
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
