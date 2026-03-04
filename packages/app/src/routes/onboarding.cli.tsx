import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/onboarding/cli")({
  loader: async () => {
    const auth = await getAuth();

    if (!auth.user) {
      const signInUrl = await getSignInUrl({ data: "/onboarding/cli" });
      throw redirect({ href: signInUrl });
    }

    if (!auth.organizationId) {
      throw redirect({ to: "/onboarding/organization" });
    }

    return null;
  },
  component: OnboardingCliStep,
});

function OnboardingCliStep() {
  const navigate = useNavigate();

  return (
    <main className="bg-muted/20 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full border bg-background text-lg font-semibold">
          3
        </div>
        <h1 className="mt-6 text-center text-4xl font-semibold tracking-tight">
          Install the CLI
        </h1>

        <section className="bg-background mt-10 rounded-2xl border px-6 py-8 sm:px-12">
          <h2 className="text-2xl font-semibold">Install Everr CLI</h2>
          <p className="text-muted-foreground mt-2 text-base">
            Run this command in your terminal.
          </p>

          <div className="mt-8 rounded-lg border bg-muted/40 p-4">
            <code className="block overflow-x-auto text-sm">
              curl -fsSL https://everr.dev/install.sh | sh
            </code>
          </div>

          <div className="mt-8 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => void navigate({ to: "/onboarding/github" })}
            >
              Back
            </Button>
            <Button
              type="button"
              size="lg"
              onClick={() => void navigate({ to: "/dashboard" })}
            >
              Go to dashboard
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
