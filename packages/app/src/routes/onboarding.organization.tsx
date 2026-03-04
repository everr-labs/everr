import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { getAuth, getSignInUrl } from "@workos/authkit-tanstack-react-start";
import { useState } from "react";
import { OrganizationNameSchema } from "@/common/organization-name";
import { Button } from "@/components/ui/button";
import { createOrganizationForCurrentUser } from "@/data/onboarding";

export const Route = createFileRoute("/onboarding/organization")({
  loader: async () => {
    const auth = await getAuth();

    if (!auth.user) {
      const signInUrl = await getSignInUrl({
        data: "/onboarding/organization",
      });
      throw redirect({ href: signInUrl });
    }

    if (auth.organizationId) {
      throw redirect({ to: "/onboarding/github" });
    }

    return {
      user: auth.user,
      organizationId: null,
      organizationName: null,
    };
  },
  component: OnboardingOrganizationStep,
});

function OnboardingOrganizationStep() {
  const {
    user,
    organizationId,
    organizationName: currentOrganizationName,
  } = Route.useLoaderData();
  const navigate = useNavigate();

  const [organizationName, setOrganizationName] = useState(
    currentOrganizationName ?? "",
  );
  const [organizationNameValidationError, setOrganizationNameValidationError] =
    useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleOrgNameValidation() {
    const parsed = OrganizationNameSchema.safeParse(organizationName);
    setOrganizationNameValidationError(
      parsed.success ? null : (parsed.error.issues[0]?.message ?? null),
    );
    return parsed.success;
  }

  async function handleOrganizationSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const isNameValid = await handleOrgNameValidation();
    if (!isNameValid) {
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await createOrganizationForCurrentUser({
        data: { organizationName },
      });
      await navigate({ to: "/onboarding/github" });
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
    <main className="bg-muted/20 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mx-auto flex size-14 items-center justify-center rounded-full border bg-background text-lg font-semibold">
          1
        </div>
        <h1 className="mt-6 text-center text-4xl font-semibold tracking-tight">
          Set up your organization
        </h1>
        <p className="text-muted-foreground mt-3 text-center text-base">
          Signed in as {user.email ?? "your account"}
        </p>

        <section className="bg-background mt-10 rounded-2xl border px-6 py-8 sm:px-12">
          <h2 className="text-2xl font-semibold">Organization details</h2>
          <p className="text-muted-foreground mt-2 text-base">
            Create your organization to get started with Everr.
          </p>

          <form className="mt-8 space-y-4" onSubmit={handleOrganizationSubmit}>
            <div className="space-y-2">
              <label
                htmlFor="organization-name"
                className="text-sm font-medium"
              >
                Organization name
              </label>
              <input
                id="organization-name"
                value={organizationName}
                onBlur={() => void handleOrgNameValidation()}
                onChange={(event) => setOrganizationName(event.target.value)}
                placeholder="Acme Inc"
                required
                minLength={2}
                maxLength={100}
                autoComplete="organization"
                className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/30 h-12 w-full rounded-lg border px-4 text-base outline-none focus-visible:ring-2"
              />
              {organizationNameValidationError ? (
                <p className="text-sm text-destructive" role="alert">
                  {organizationNameValidationError}
                </p>
              ) : null}
            </div>

            {errorMessage ? (
              <p className="text-sm text-destructive" role="alert">
                {errorMessage}
              </p>
            ) : null}

            <div className="flex items-center justify-between pt-2">
              <Button type="submit" size="lg" disabled={isSubmitting}>
                {isSubmitting
                  ? "Saving..."
                  : organizationId
                    ? "Continue"
                    : "Create and continue"}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}
