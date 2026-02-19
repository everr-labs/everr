import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { useState } from "react";
import { createOrganizationForCurrentUser } from "@/data/onboarding";

export const Route = createFileRoute("/setup/organization")({
  loader: async () => {
    const auth = await getAuth();

    if (!auth.user) {
      const signInUrl = await getSignInUrl({ data: "/setup/organization" });
      throw redirect({ href: signInUrl });
    }

    if (auth.organizationId) {
      throw redirect({ to: "/dashboard" });
    }

    return { user: auth.user };
  },
  component: OrganizationSetupPage,
});

function OrganizationSetupPage() {
  const { user } = Route.useLoaderData();
  const navigate = useNavigate();

  const [organizationName, setOrganizationName] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await createOrganizationForCurrentUser({
        data: { organizationName },
      });
      await navigate({ to: "/dashboard" });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "We couldn't finish setup. Please try again.";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Set up your organization</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Welcome {user.email}. Create your organization to continue.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label htmlFor="organization-name" className="text-xs font-medium">
              Organization name
            </label>
            <input
              id="organization-name"
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder="Acme Inc"
              required
              minLength={2}
              maxLength={100}
              autoComplete="organization"
              className="bg-input/20 dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/30 h-9 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-2"
            />
          </div>

          {errorMessage ? (
            <p className="text-xs text-destructive" role="alert">
              {errorMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {isSubmitting ? "Creating organization..." : "Create organization"}
          </button>
        </form>
      </div>
    </div>
  );
}
