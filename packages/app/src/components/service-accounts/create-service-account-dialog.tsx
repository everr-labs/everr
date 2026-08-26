import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { Bot, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCreateServiceAccount } from "@/components/service-accounts/queries";
import { SecretReveal } from "@/components/service-accounts/secret-reveal";
import {
  SERVICE_ACCOUNT_ROLES,
  type ServiceAccountRole,
} from "@/data/service-accounts";

const ROLE_LABELS: Record<ServiceAccountRole, string> = {
  admin: "Admin",
  member: "Member",
};

export function CreateServiceAccountDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<ServiceAccountRole>("member");
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  const create = useCreateServiceAccount();

  const reset = () => {
    setName("");
    setRole("member");
    setIssuedSecret(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && create.isPending) return;
    // Reset on open, not close: clearing `issuedSecret` on close would swap
    // the success screen back to the form mid close-out animation. Closing
    // keeps whatever was shown; the next open starts fresh.
    if (next) reset();
    setOpen(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(
      { name: trimmed, role },
      {
        onSuccess: (data) => {
          setIssuedSecret(data.secret);
          toast.success("Service account created");
        },
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Plus className="size-4" />
        New service account
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {issuedSecret ? (
          <SecretReveal
            secret={issuedSecret}
            title="Copy the secret now"
            description="This is the only time the full secret is shown. Store it in your secret manager. You won't be able to retrieve it later."
            onDone={() => handleOpenChange(false)}
          />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
                  <Bot className="size-4" />
                </span>
                New service account
              </DialogTitle>
              <DialogDescription>
                A machine member of this organization. It exchanges its secret
                for a short-lived bearer token, the same way a person signs in.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="service-account-name">Name</Label>
                <Input
                  id="service-account-name"
                  name="service-account-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ci-deploy-bot"
                  required
                  autoFocus
                  autoComplete="off"
                  data-1p-ignore
                  data-lpignore="true"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="service-account-role">Role</Label>
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v as ServiceAccountRole)}
                >
                  <SelectTrigger id="service-account-role" className="w-full">
                    <SelectValue>{ROLE_LABELS[role]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_ACCOUNT_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={create.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Create service account
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
