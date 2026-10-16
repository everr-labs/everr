import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function PasswordSettings({ hasPassword }: { hasPassword: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const change = useMutation({
    mutationFn: async () => {
      if (newPassword !== confirmation) {
        throw new Error("New passwords do not match.");
      }
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: false,
      });
      if (result.error)
        throw new Error(
          result.error.message ?? "Could not change your password.",
        );
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          {hasPassword
            ? "Your browser and CLI sessions stay signed in when you change your password."
            : "Your password is managed by your sign-in provider."}
        </CardDescription>
      </CardHeader>
      {hasPassword && (
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (change.isPending) return;
              change.mutate();
            }}
            onChange={() => change.reset()}
          >
            <div className="space-y-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                disabled={change.isPending}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                disabled={change.isPending}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Use 8 to 128 characters.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                disabled={change.isPending}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
            {change.error && (
              <p role="alert" className="text-sm text-destructive">
                {change.error.message}
              </p>
            )}
            {change.isSuccess && (
              <p role="status" className="text-sm text-muted-foreground">
                Password changed.
              </p>
            )}
            <Button type="submit" disabled={change.isPending}>
              {change.isPending ? "Changing password..." : "Change password"}
            </Button>
          </form>
        </CardContent>
      )}
    </Card>
  );
}
