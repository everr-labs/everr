/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Preserve the existing status element and layout during the linter migration. */
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
import { authClient } from "#app/lib/auth-client.ts";

export function ProfileSettings({ user }: { user: { name: string; email: string } }) {
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? user.name;
  const save = useMutation({
    mutationFn: async () => {
      const result = await authClient.updateUser({ name: name.trim() });
      if (result.error) throw new Error(result.error.message ?? "Could not save your profile.");
    },
  });
  const canSave = !save.isPending && Boolean(name.trim()) && name.trim() !== user.name;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>Your name is visible to other workspace members.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) save.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="account-name">Name</Label>
            <Input
              id="account-name"
              autoComplete="name"
              required
              maxLength={100}
              value={name}
              disabled={save.isPending}
              onChange={(event) => {
                setDraft(event.target.value);
                save.reset();
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-email">Email</Label>
            <Input
              id="account-email"
              type="email"
              autoComplete="email"
              value={user.email}
              readOnly
            />
          </div>
          {save.error && (
            <p role="alert" className="text-sm text-destructive">
              {save.error.message}
            </p>
          )}
          {save.isSuccess && (
            <p role="status" className="text-sm text-muted-foreground">
              Profile saved.
            </p>
          )}
          <Button type="submit" disabled={!canSave}>
            {save.isPending ? "Saving..." : "Save profile"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
