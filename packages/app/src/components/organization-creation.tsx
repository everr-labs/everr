import { Button } from "@everr/ui/components/button";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { Check, Sparkles, UserRound } from "lucide-react";
import { type SubmitEvent, useEffect, useRef, useState } from "react";
import { CreateOrganizationInputSchema } from "@/common/organization-name";
import { OrganizationProvisioningContent } from "@/components/organization-provisioning-content";
import { OrganizationProvisioningRetry } from "@/components/organization-provisioning-retry";
import { useOrganizationActivation } from "@/components/use-organization-activation";
import {
  ORGANIZATION_SETUP_MINIMUM_MS,
  useOrganizationSetupCompletion,
} from "@/components/use-organization-setup-completion";
import { getOrganizationProvisioningStatus } from "@/data/organization-provisioning";
import { createOrganization } from "@/data/organizations";

export function OrganizationCreation({
  canCreateHobby,
  returnTo = "/",
  notice,
  onStart,
}: {
  canCreateHobby: boolean;
  returnTo?: string;
  notice?: string | null;
  onStart?: () => void;
}) {
  const router = useRouter();
  const selectOrganization = useOrganizationActivation();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [plan, setPlan] = useState<"hobby" | "pro">(
    canCreateHobby ? "hobby" : "pro",
  );
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [createdOrganizationId, setCreatedOrganizationId] = useState<
    string | null
  >(null);
  const [activated, setActivated] = useState(false);
  const isCreating = startedAt !== null;
  const readiness = useQuery({
    queryKey: ["organization-provisioning", createdOrganizationId],
    queryFn: () => getOrganizationProvisioningStatus(),
    enabled: activated && createdOrganizationId !== null,
    refetchInterval: (query) =>
      query.state.data?.status === "failed" ? false : 1000,
    staleTime: 0,
  });
  useOrganizationSetupCompletion(
    !error &&
      readiness.isSuccess &&
      !readiness.isFetching &&
      activated &&
      readiness.data?.id === createdOrganizationId &&
      readiness.data?.status === "ready",
    startedAt ?? 0,
    returnTo,
  );

  async function activateOrganization(organizationId: string) {
    try {
      await selectOrganization(organizationId);
    } catch (cause) {
      throw new Error(
        "Your organization was created, but we couldn't select it. Try again or choose it from your organizations.",
        { cause },
      );
    }
    if (mounted.current) setActivated(true);
  }

  async function handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    if (isCreating) return;

    const parsed = CreateOrganizationInputSchema.safeParse({
      plan,
      organizationName,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid name.");
      return;
    }

    setError(null);
    onStart?.();
    const start = Date.now();
    setStartedAt(start);

    try {
      const result = await createOrganization({ data: parsed.data });
      if (!mounted.current) return;
      if (result.kind === "checkout") {
        await new Promise<void>((resolve) =>
          setTimeout(
            resolve,
            Math.max(0, start + ORGANIZATION_SETUP_MINIMUM_MS - Date.now()),
          ),
        );
        if (mounted.current)
          await router.navigate({ href: result.url, reloadDocument: true });
        return;
      }
      setCreatedOrganizationId(result.organization.id);
      await activateOrganization(result.organization.id);
    } catch (cause) {
      if (!mounted.current) return;
      setError(
        cause instanceof Error
          ? cause.message
          : "The organization could not be created.",
      );
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-10 lg:min-h-screen lg:py-16">
      <div className="w-full max-w-sm space-y-8">
        {isCreating ? (
          <OrganizationProvisioningContent
            checkout={plan === "pro"}
            pending={!error}
            failed={!error && readiness.data?.status === "failed"}
          >
            {error ? (
              <div className="space-y-3">
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
                <Button
                  className="w-full"
                  onClick={() => {
                    if (createdOrganizationId) {
                      setError(null);
                      void activateOrganization(createdOrganizationId).catch(
                        (cause: Error) => setError(cause.message),
                      );
                    } else {
                      setStartedAt(null);
                    }
                  }}
                >
                  {createdOrganizationId
                    ? "Try selecting again"
                    : "Back to organization details"}
                </Button>
                <Link
                  to="/choose-organization"
                  search={{ returnTo }}
                  className="text-sm text-muted-foreground hover:text-foreground"
                >
                  Choose an existing organization
                </Link>
              </div>
            ) : readiness.data?.status === "failed" ? (
              <OrganizationProvisioningRetry
                key={readiness.data.id}
                organizationId={readiness.data.id}
              />
            ) : null}
          </OrganizationProvisioningContent>
        ) : (
          <form
            onSubmit={handleSubmit}
            aria-label="Organization details"
            className="space-y-6"
          >
            <div className="space-y-4">
              <p className="text-xs font-medium text-muted-foreground">
                Your organization
              </p>
              <h1 className="font-heading text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
                Let's get you settled
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Give your organization a name and choose a plan to get started.
              </p>
            </div>
            <div className="space-y-4">
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
                  You already own a Hobby organization, so this organization
                  must use Pro.
                </p>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="organization-name">Organization name</Label>
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
              {error || notice ? (
                <p
                  id="organization-create-error"
                  className="text-sm text-destructive"
                  role="alert"
                >
                  {error ?? notice}
                </p>
              ) : null}
            </div>
            <Button type="submit" className="w-full">
              {plan === "pro" ? "Continue to checkout" : "Create organization"}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
