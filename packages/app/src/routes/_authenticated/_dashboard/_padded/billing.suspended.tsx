import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@everr/ui/components/alert-dialog";
import { Button } from "@everr/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@everr/ui/components/card";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AlertTriangle, ArrowUpRight, CreditCard, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  downgradeSuspendedOrganization,
  getOrgPortalUrl,
  getSuspendedOrgRecovery,
} from "@/data/billing";

export const Route = createFileRoute(
  "/_authenticated/_dashboard/_padded/billing/suspended",
)({
  staticData: {
    breadcrumb: "Subscription suspended",
    hideTimeRangePicker: true,
  },
  head: () => ({ meta: [{ title: "Everr - Subscription suspended" }] }),
  loader: async () => {
    const recovery = await getSuspendedOrgRecovery();
    if (recovery.entitlement.appState !== "suspended") {
      throw redirect({ to: "/" });
    }
    return recovery;
  },
  component: SuspendedOrganizationPage,
});

function SuspendedOrganizationPage() {
  const recovery = Route.useLoaderData();
  const [openingPortal, setOpeningPortal] = useState(false);
  const [downgrading, setDowngrading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setError(null);
    setOpeningPortal(true);
    try {
      const result = await getOrgPortalUrl();
      if (result.status === "customer_missing") {
        window.location.assign("/billing");
        return;
      }
      window.location.assign(result.url);
    } catch {
      setError("The billing portal could not be opened. Please try again.");
      setOpeningPortal(false);
    }
  }

  async function downgrade() {
    setError(null);
    setDowngrading(true);
    try {
      await downgradeSuspendedOrganization();
      window.location.assign("/");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The organization could not be downgraded.",
      );
      setDowngrading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardHeader>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-5" />
          </div>
          <CardTitle>Pro subscription suspended</CardTitle>
          <CardDescription>
            This organization no longer has an active Pro subscription.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {recovery.canManageBilling ? (
            <>
              <p className="text-sm text-muted-foreground">
                Manage the subscription in Polar, or repair missing billing
                details in Plan & Billing, to restore the organization.
              </p>
              <Button
                onClick={() => void openPortal()}
                disabled={openingPortal}
              >
                {openingPortal ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <CreditCard />
                )}
                {openingPortal ? "Opening billing..." : "Manage billing"}
                {!openingPortal ? <ArrowUpRight /> : null}
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Contact an organization Owner or Admin to restore billing.
            </p>
          )}
        </CardContent>
      </Card>

      {recovery.canDowngrade ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Downgrade to Hobby</CardTitle>
            <CardDescription>
              Hobby is an individual plan. You will remain as the only member;
              every other member will be removed and pending invitations will be
              canceled.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recovery.ownsAnotherHobby ? (
              <p className="text-sm text-muted-foreground">
                You already own a Hobby organization. Upgrade that organization
                to Pro before downgrading this one.
              </p>
            ) : (
              <AlertDialog>
                <AlertDialogTrigger
                  render={<Button variant="outline" disabled={downgrading} />}
                >
                  Downgrade to Hobby
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Remove all other members?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This immediately removes every other member and cancels
                      all pending invitations. You will remain the sole Owner.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={downgrading}>
                      Cancel
                    </AlertDialogCancel>
                    <AlertDialogAction
                      disabled={downgrading}
                      onClick={() => void downgrade()}
                    >
                      {downgrading ? (
                        <Loader2 className="animate-spin" />
                      ) : null}
                      Confirm downgrade
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
