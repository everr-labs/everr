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
import { Building2, Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { CreateOrganizationInputSchema } from "@/common/organization-name";
import { createOrganization } from "@/data/organizations";
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
  component: CreateOrganizationPage,
});

function CreateOrganizationPage() {
  const [organizationName, setOrganizationName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCreating) return;

    const parsed = CreateOrganizationInputSchema.safeParse({
      organizationName,
      billingEmail,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid name.");
      return;
    }

    setError(null);
    setIsCreating(true);

    try {
      const organization = await createOrganization({ data: parsed.data });
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
              Give your team a name and a unique email for billing. You can
              configure members and integrations after creation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
                This address identifies the organization in Polar and receives
                billing communications. It must not be used by another
                organization.
              </p>
            </div>
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
              Create organization
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
