import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { changeOrgBillingOwner, getOrgBillingSettings } from "@/data/billing";

export function BillingOwnerCard({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const queryKey = ["billing", "settings", orgId];
  const settings = useQuery({
    queryKey,
    queryFn: () => getOrgBillingSettings(),
  });
  const transfer = useMutation({
    mutationFn: (userId: string) => changeOrgBillingOwner({ data: { userId } }),
    onSuccess: () => client.invalidateQueries({ queryKey }),
  });
  if (!settings.data && !settings.error) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Billing owner</CardTitle>
        <CardDescription>
          The billing owner receives billing communications and is responsible
          for this organization's billing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {settings.error ? (
          <p role="alert">
            Billing settings could not be loaded. Please try again.
          </p>
        ) : (
          <>
            <p>
              {settings.data?.owner
                ? `${settings.data.owner.name} (${settings.data.owner.email})`
                : "The billing owner is assigned when billing starts."}
            </p>
            {settings.data?.canChangeOwner && (
              <form
                key={settings.data.owner?.id ?? "unassigned"}
                className="flex items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  transfer.mutate(String(form.get("userId")));
                }}
              >
                <label className="flex flex-col gap-2 text-sm">
                  Responsible owner
                  <select
                    name="userId"
                    aria-label="Billing owner"
                    defaultValue={settings.data.owner?.id ?? ""}
                    required
                    className="rounded-md border bg-background p-2"
                  >
                    <option value="" disabled>
                      Select an owner
                    </option>
                    {settings.data.candidates.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name} ({person.email})
                      </option>
                    ))}
                  </select>
                </label>
                <Button type="submit" disabled={transfer.isPending}>
                  {transfer.isPending ? "Saving…" : "Save billing owner"}
                </Button>
              </form>
            )}
            {transfer.error && (
              <p role="alert" className="text-destructive text-sm">
                {transfer.error.message}
              </p>
            )}
            {transfer.isSuccess && (
              <p role="status" className="text-sm">
                Billing owner updated.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
