import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/cli/device")({
  validateSearch: z.object({
    code: z.string().optional(),
  }),
  loader: async ({ location }) => {
    const auth = await getAuth();

    if (!auth.user) {
      const signInUrl = await getSignInUrl({ data: location.href });
      throw redirect({ href: signInUrl });
    }

    return {
      deviceCode: location.search.code?.toUpperCase() ?? "",
    };
  },
  component: CliDeviceApprovalPage,
});

function formatCodeForDisplay(code: string): string {
  return code.toUpperCase().split("").join(" ");
}

function CliDeviceApprovalPage() {
  const { deviceCode } = Route.useLoaderData();
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
      body: JSON.stringify({
        user_code: deviceCode,
        action,
      }),
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
                  onClick={() => submit("deny")}
                >
                  Deny
                </Button>
                <Button
                  size="lg"
                  disabled={isSubmitting}
                  onClick={() => submit("approve")}
                >
                  Confirm
                </Button>
              </div>

              {status === "error" ? (
                <p className="mt-4 text-center text-sm text-red-600 dark:text-red-400">
                  Invalid or expired code. Restart `everr login` from your
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
