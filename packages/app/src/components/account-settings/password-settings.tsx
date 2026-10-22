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
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { authClient } from "#app/lib/auth-client.ts";

const defaultValues = {
  currentPassword: "",
  newPassword: "",
  confirmation: "",
};

export function PasswordSettings({ hasPassword }: { hasPassword: boolean }) {
  const change = useMutation({
    mutationFn: async ({ currentPassword, newPassword, confirmation }: typeof defaultValues) => {
      if (newPassword !== confirmation) {
        throw new Error("New passwords do not match.");
      }
      const result = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: false,
      });
      if (result.error) throw new Error(result.error.message ?? "Could not change your password.");
    },
  });
  const form = useForm({
    defaultValues,
    onSubmit: ({ value, formApi }) => change.mutate(value, { onSuccess: () => formApi.reset() }),
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
              void form.handleSubmit();
            }}
            onChange={() => change.reset()}
          >
            <form.Field name="currentPassword">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="current-password">Current password</Label>
                  <Input
                    id="current-password"
                    name={field.name}
                    type="password"
                    autoComplete="current-password"
                    required
                    disabled={change.isPending}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </div>
              )}
            </form.Field>
            <form.Field name="newPassword">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    name={field.name}
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                    disabled={change.isPending}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Use 8 to 128 characters.</p>
                </div>
              )}
            </form.Field>
            <form.Field name="confirmation">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input
                    id="confirm-password"
                    name={field.name}
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={128}
                    required
                    disabled={change.isPending}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                </div>
              )}
            </form.Field>
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
