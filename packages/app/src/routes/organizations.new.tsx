import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Input } from "@everr/ui/components/input";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Building2, Check, Loader2, Sparkles, UserRound } from "lucide-react";
import { type FormEvent, useState } from "react";
import { CreateOrganizationInputSchema } from "@/common/organization-name";
import {
  createOrganization,
  getOrganizationCreationOptions,
} from "@/data/organizations";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/organizations/new")({
  beforeLoad: ({ context: { session } }) => {
    if (!session?.user) {
      throw redirect({
        to: "/auth/sign-in",
        search: { redirect: "/organizations/new" },
      });
    }
  },
  head: () => ({ meta: [{ title: "Everr - Create organization" }] }),
  loader: () => getOrganizationCreationOptions(),
  component: CreateOrganizationPage,
});

function CreateOrganizationPage() {
  const { canCreateHobby } = Route.useLoaderData();
  const [plan, setPlan] = useState<"hobby" | "pro">(
    canCreateHobby ? "hobby" : "pro",
  );
  const [organizationName, setOrganizationName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreating) return;

    const parsed = CreateOrganizationInputSchema.safeParse(
      plan === "hobby"
        ? { plan, organizationName }
        : { plan, organizationName, billingEmail },
    );
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid name.");
      return;
    }

    setError(null);
    setIsCreating(true);

    try {
      const result = await createOrganization({ data: parsed.data });
      if (result.kind === "checkout") {
        window.location.assign(result.url);
        return;
      }

      const organization = result.organization;
      const activation = await authClient.organization.setActive({
        organizationId: organization.id,
      });

      if (activation.error) {
        setError(
          "The organization and billing customer were created, but the organization could not be selected. You can select it from the organization menu.",
        );
        setIsCreating(false);
        return;
      }

      window.location.assign("/");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The organization could not be created.",
      );
      setIsCreating(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-lg">
        <form onSubmit={handleSubmit}>
          <CardHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Building2 className="size-5" />
            </div>
            <CardTitle className="font-heading text-2xl">
              Create an organization
            </CardTitle>
            <CardDescription>
              Choose an individual Hobby organization or create a collaborative
              Pro organization.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {canCreateHobby ? (
                <button
                  type="button"
                  disabled={isCreating}
                  aria-pressed={plan === "hobby"}
                  onClick={() => setPlan("hobby")}
                  className={`rounded-lg border p-4 text-left transition-colors ${
                    plan === "hobby"
                      ? "border-primary bg-primary/5"
                      : "hover:border-foreground/30"
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <UserRound className="size-5" />
                    {plan === "hobby" ? (
                      <Check className="size-4 text-primary" />
                    ) : null}
                  </div>
                  <p className="font-medium">Hobby</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Free, for one Owner.
                  </p>
                </button>
              ) : null}
              <button
                type="button"
                disabled={isCreating}
                aria-pressed={plan === "pro"}
                onClick={() => setPlan("pro")}
                className={`rounded-lg border p-4 text-left transition-colors ${
                  plan === "pro"
                    ? "border-primary bg-primary/5"
                    : "hover:border-foreground/30"
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <Sparkles className="size-5" />
                  {plan === "pro" ? (
                    <Check className="size-4 text-primary" />
                  ) : null}
                </div>
                <p className="font-medium">Pro</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Paid, with team members.
                </p>
              </button>
            </div>
            {!canCreateHobby ? (
              <p className="text-xs text-muted-foreground">
                You already own a Hobby organization, so this organization must
                use Pro.
              </p>
            ) : null}
            <div className="space-y-2">
              <label
                htmlFor="organization-name"
                className="text-sm font-medium"
              >
                Organization name
              </label>
              <Input
                id="organization-name"
                name="organizationName"
                autoComplete="organization"
                autoFocus
                maxLength={100}
                value={organizationName}
                disabled={isCreating}
                placeholder="Acme"
                onChange={(event) => setOrganizationName(event.target.value)}
              />
            </div>
            {plan === "pro" ? (
              <div className="space-y-2">
                <label htmlFor="billing-email" className="text-sm font-medium">
                  Billing email
                </label>
                <Input
                  id="billing-email"
                  name="billingEmail"
                  type="email"
                  autoComplete="email"
                  value={billingEmail}
                  disabled={isCreating}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={
                    error ? "organization-create-error" : undefined
                  }
                  placeholder="billing@example.com"
                  onChange={(event) => setBillingEmail(event.target.value)}
                />
                <p className="text-muted-foreground text-xs">
                  Polar uses this unique address for billing. The organization
                  is created after Polar confirms an active Pro subscription.
                </p>
              </div>
            ) : null}
            {error ? (
              <p
                id="organization-create-error"
                className="text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </CardContent>
          <CardFooter className="justify-end gap-2 border-t pt-6">
            <Button
              variant="outline"
              disabled={isCreating}
              nativeButton={false}
              render={<Link to="/" />}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? <Loader2 className="animate-spin" /> : null}
              {plan === "pro" ? "Continue to checkout" : "Create organization"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
