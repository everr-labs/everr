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
import { Switch } from "@everr/ui/components/switch";
import { useRouteContext } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { invitationUrl } from "#app/common/invitation.ts";
import { InvitationLink } from "./invitation-link";
import { useInviteMember } from "./queries";
import { type OrgRole, OrgRoleSchema } from "./schemas";

export function InviteMemberDialog() {
  const { emailEnabled } = useRouteContext({ from: "__root__" });
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [sendEmail, setSendEmail] = useState(true);
  const shouldSendEmail = emailEnabled && sendEmail;
  const invite = useInviteMember();

  const reset = () => {
    setEmail("");
    setRole("member");
    setSendEmail(true);
    invite.reset();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && invite.isPending) return;
    if (next) reset();
    setOpen(next);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    invite.mutate(
      { email: trimmed, role, sendEmail: shouldSendEmail },
      {
        onError: (err) => toast.error(err.message),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button size="sm" />}>Invite member</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        {invite.data ? (
          <div className="space-y-4">
            <DialogHeader>
              <DialogTitle>Invitation created</DialogTitle>
              <DialogDescription>
                {email.trim()} can join your workspace using the link below.
              </DialogDescription>
            </DialogHeader>
            <InvitationLink
              url={invitationUrl(invite.data.id, window.location.origin)}
              onClose={() => handleOpenChange(false)}
            />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Invite member</DialogTitle>
              <DialogDescription>
                Create an invitation to share by link or email. Inviting the same email again
                replaces its previous invitation.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  placeholder="colleague@company.com"
                  value={email}
                  disabled={invite.isPending}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  // oxlint-disable-next-line jsx-a11y/no-autofocus -- Focus starts in the primary field when this user-opened dialog mounts.
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="invite-role">Role</Label>
                <Select
                  value={role}
                  disabled={invite.isPending}
                  onValueChange={(value) => {
                    const next = OrgRoleSchema.safeParse(value);
                    if (next.success) setRole(next.data);
                  }}
                >
                  <SelectTrigger id="invite-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="owner">Owner</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="invite-send-email"
                checked={shouldSendEmail}
                disabled={!emailEnabled || invite.isPending}
                onCheckedChange={setSendEmail}
              />
              <Label htmlFor="invite-send-email">Send invitation email</Label>
            </div>
            {!emailEnabled && (
              <p className="text-sm text-muted-foreground">
                Email is not configured. Share the invitation link directly.
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={invite.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={invite.isPending}>
                {invite.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Create invitation
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
