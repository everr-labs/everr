import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/onboarding/github-success")({
  loader: async () => {
    const auth = await getAuth();

    if (!auth.user) {
      const signInUrl = await getSignInUrl({
        data: "/onboarding/github-success",
      });
      throw redirect({ href: signInUrl });
    }
  },
  component: GithubInstallSuccessPage,
});

function GithubInstallSuccessPage() {
  return (
    <main className="bg-muted/20 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full border border-green-200 bg-green-50 text-green-600 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
          <CheckCircle2 className="size-8" />
        </div>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight">
          Installation successful
        </h1>
        <p className="text-muted-foreground mt-3 text-base">
          The Everr GitHub App has been installed. You can close this tab and
          continue setup in the original window.
        </p>

        <div className="mt-8">
          <Button type="button" size="lg" onClick={() => window.close()}>
            Close this tab
          </Button>
        </div>
      </div>
    </main>
  );
}
