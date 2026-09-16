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
import { Building2, Loader2 } from "lucide-react";
import { type SubmitEvent, useState } from "react";
import { CreateOrganizationInputSchema } from "@/common/organization-name";
import { createOrganization } from "@/data/organizations";
import { authClient } from "@/lib/auth-client";

export function CreateOrganizationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [organizationName, setOrganizationName] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function handleSubmit(event: SubmitEvent) {
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
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!isCreating) onOpenChange(open);
      }}
      onOpenChangeComplete={(open) => {
        if (!open) {
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
              Give your team a name and a unique email for billing. You can
              configure members and integrations after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
              Create organization
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
