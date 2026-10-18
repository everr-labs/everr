import { productUI } from "@composition/ui";
import { Button } from "@everr/ui/components/button";
import { Label } from "@everr/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { getOrganizations } from "#app/data/auth.ts";
import { approveDevice, denyDevice } from "#app/lib/device-auth.ts";

export const Route = createFileRoute("/_authenticated/_organization/device")({
  staticData: { authEntry: "/auth/sign-up" },
  validateSearch: z.object({
    user_code: z.string().min(1, "Missing device code"),
    organization_id: z.string().optional(),
  }),
  loaderDeps: ({ search }) => ({
    code: search.user_code,
  }),
  loader: async ({ deps, context: { session } }) => {
    const organizations = await getOrganizations();

    const firstName =
      session.user.name?.split(" ")[0] ?? session.user.email.split("@")[0];

    return {
      deviceCode: deps.code.toUpperCase(),
      userName: firstName,
      organizations,
      activeOrganizationId: session.session.activeOrganizationId,
    };
  },
  component: CliDeviceApprovalPage,
  errorComponent: DeviceApprovalError,
});

function formatCodeForDisplay(code: string): string {
  return code.toUpperCase().split("").join(" ");
}

function CliDeviceApprovalPage() {
  const { deviceCode, userName, organizations, activeOrganizationId } =
    Route.useLoaderData();
  const { organization_id: expectedOrganizationId } = Route.useSearch();
  const [selection, setSelection] = useState<string | null>(null);
  const selectedOrganization =
    organizations.find(
      (org) => org.id === (selection ?? activeOrganizationId),
    ) ?? organizations[0];
  const targetMismatch = Boolean(
    expectedOrganizationId &&
      expectedOrganizationId !== selectedOrganization?.id,
  );
  const [status, setStatus] = useState<
    "idle" | "approved" | "denied" | "error"
  >("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function submit(action: "approve" | "deny") {
    if (
      !deviceCode ||
      (action === "approve" && (!selectedOrganization || targetMismatch))
    ) {
      setErrorMessage("Select an organization before authorizing this device.");
      setStatus("error");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const result =
        action === "approve"
          ? await approveDevice(deviceCode, selectedOrganization.id)
          : await denyDevice(deviceCode);

      if (!result.ok) {
        setErrorMessage(result.message);
        setStatus("error");
        return;
      }

      setStatus(action === "approve" ? "approved" : "denied");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Could not authorize the device.",
      );
      setStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="bg-muted/20 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <h1 className="text-center text-4xl font-semibold tracking-tight">
          Authenticate Device
        </h1>
        <p className="text-muted-foreground mt-3 text-center text-base">
          {selectedOrganization
            ? `${userName} · ${selectedOrganization.name}`
            : userName}
        </p>

        {targetMismatch && (
          <p role="alert" className="mt-3 text-center text-sm text-destructive">
            Select organization {expectedOrganizationId} to authorize this
            profile.
          </p>
        )}

        <section className="bg-background mt-10 rounded-2xl border px-6 py-10 sm:px-12">
          {status === "idle" || status === "error" ? (
            <>
              <p className="text-center text-[32px] leading-none font-semibold uppercase sm:text-[56px]">
                {formatCodeForDisplay(deviceCode)}
              </p>
              <p className="text-muted-foreground mt-6 text-center text-base">
                Confirm this code is shown on your device
              </p>

              {organizations.length > 1 ? (
                <div className="mt-8 space-y-2">
                  <Label htmlFor="device-organization">Organization</Label>
                  <Select
                    items={organizations.map((org) => ({
                      value: org.id,
                      label: org.name,
                    }))}
                    value={selectedOrganization.id}
                    onValueChange={setSelection}
                    disabled={isSubmitting}
                  >
                    <SelectTrigger id="device-organization" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {organizations.map((org) => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-sm">
                    Your device will access this organization's data.
                  </p>
                </div>
              ) : null}

              <div className="mt-10 grid grid-cols-2 gap-4">
                <Button
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => void submit("deny")}
                >
                  Deny
                </Button>
                <Button
                  disabled={
                    isSubmitting || !selectedOrganization || targetMismatch
                  }
                  onClick={() => void submit("approve")}
                >
                  Confirm
                </Button>
              </div>

              {status === "error" ? (
                <p
                  role="alert"
                  className="text-destructive mt-4 text-center text-sm"
                >
                  {errorMessage} <productUI.DeviceLoginRecovery />
                </p>
              ) : null}
            </>
          ) : null}

          {status === "approved" ? (
            <div className="py-12 text-center">
              <p className="text-2xl font-semibold">Device approved</p>
              <p className="text-muted-foreground mt-3 text-base">
                You can return to your terminal.
              </p>
            </div>
          ) : null}

          {status === "denied" ? (
            <div className="py-12 text-center">
              <p className="text-2xl font-semibold">Request denied</p>
              <p className="text-muted-foreground mt-3 text-base">
                The sign-in request was denied. You can close this page.
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function DeviceApprovalError() {
  return (
    <main className="bg-muted/20 flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <section className="bg-background rounded-2xl border px-6 py-10 text-center sm:px-12">
          <p className="text-2xl font-semibold">Invalid device request</p>
          <p className="text-muted-foreground mt-3 text-base">
            This approval link is missing its device code. Please try again
          </p>
        </section>
      </div>
    </main>
  );
}
