import { Button } from "@everr/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { getActiveOrganization } from "@/data/auth";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated/device")({
  validateSearch: z.object({
    user_code: z.string().min(1, "Missing device code"),
  }),
  loaderDeps: ({ search }) => ({
    code: search.user_code,
  }),
  loader: async ({ deps, context: { session } }) => {
    const orgName = await getActiveOrganization()
      .then((org) => org?.name ?? null)
      .catch(() => null);

    const firstName =
      session.user.name?.split(" ")[0] ?? session.user.email.split("@")[0];

    return {
      deviceCode: deps.code.toUpperCase(),
      userName: firstName,
      orgName,
    };
  },
  component: CliDeviceApprovalPage,
  errorComponent: DeviceApprovalError,
});

function formatCodeForDisplay(code: string): string {
  return code.toUpperCase().split("").join(" ");
}

function CliDeviceApprovalPage() {
  const { deviceCode, userName, orgName } = Route.useLoaderData();
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

    try {
      const result =
        action === "approve"
          ? await authClient.device.approve({
              userCode: deviceCode,
            })
          : await authClient.device.deny({
              userCode: deviceCode,
            });

      if (result.error || !result.data?.success) {
        setStatus("error");
        return;
      }

      setStatus(action === "approve" ? "approved" : "denied");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="bg-muted/20 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <h1 className="text-center text-4xl font-semibold tracking-tight">
          Authenticate Device
        </h1>
        <p className="text-muted-foreground mt-3 text-center text-base">
          {orgName ? `${userName} · ${orgName}` : userName}
        </p>

        <section className="bg-background mt-10 rounded-2xl border px-6 py-10 sm:px-12">
          {status === "idle" || status === "error" ? (
            <>
              <p className="text-center text-[32px] leading-none font-semibold uppercase sm:text-[56px]">
                {formatCodeForDisplay(deviceCode)}
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

function DeviceApprovalError() {
  return (
    <main className="bg-muted/20 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <section className="bg-background rounded-2xl border px-6 py-10 text-center sm:px-12">
          <p className="text-2xl font-semibold">Invalid device request</p>
          <p className="text-muted-foreground mt-3 text-base">
            This approval link is missing its device code. Please try again
          </p>
        </section>
      </div>
    </main>
  );
}
