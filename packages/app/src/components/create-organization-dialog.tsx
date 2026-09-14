import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { Building2, Check, Loader2, Sparkles, UserRound } from "lucide-react";
import { type SubmitEvent, useState } from "react";
import { CreateOrganizationInputSchema } from "@/common/organization-name";
import { createOrganization } from "@/data/organizations";
import { authClient } from "@/lib/auth-client";

export function CreateOrganizationDialog({
  canCreateHobby,
  open,
  onOpenChange,
}: {
  canCreateHobby: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [plan, setPlan] = useState<"hobby" | "pro">(
    canCreateHobby ? "hobby" : "pro",
  );
  const [organizationName, setOrganizationName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function handleSubmit(event: SubmitEvent) {
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
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!isCreating) onOpenChange(open);
      }}
      onOpenChangeComplete={(open) => {
        if (!open) {
          setPlan(canCreateHobby ? "hobby" : "pro");
          setOrganizationName("");
          setBillingEmail("");
          setError(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!isCreating}>
        <form onSubmit={handleSubmit} className="space-y-5">
          <DialogHeader>
            <div className="mb-2 flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Building2 className="size-5" />
            </div>
            <DialogTitle className="font-heading text-2xl">
              Create an organization
            </DialogTitle>
            <DialogDescription>
              Choose an individual Hobby organization or create a collaborative
              Pro organization.
            </DialogDescription>
          </DialogHeader>
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
                You already own a Hobby organization, so this organization must
                use Pro.
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
            {plan === "pro" ? (
              <div className="space-y-2">
                <Label htmlFor="billing-email">Billing email</Label>
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
          </div>
          <DialogFooter className="justify-end gap-2 border-t pt-6">
            <Button
              variant="outline"
              disabled={isCreating}
              type="button"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? <Loader2 className="animate-spin" /> : null}
              {plan === "pro" ? "Continue to checkout" : "Create organization"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
