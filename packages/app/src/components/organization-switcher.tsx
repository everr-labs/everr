import { Button } from "@everr/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function OrganizationSwitcher({
  activeOrganizationId,
}: {
  activeOrganizationId?: string | null;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: organizations } = authClient.useListOrganizations();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchOrganization(organizationId: string) {
    setSwitching(true);
    setError(null);
    try {
      const result = await authClient.organization.setActive({
        organizationId,
      });
      if (result.error)
        throw new Error(
          result.error.message ?? "Could not switch organization.",
        );
      await queryClient.invalidateQueries({ refetchType: "none" });
      await router.invalidate();
      await queryClient.refetchQueries({ type: "active" });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not switch organization.",
      );
    } finally {
      setSwitching(false);
    }
  }

  if (!organizations || organizations.length < 2) return null;
  const activeOrganization = organizations.find(
    (org) => org.id === activeOrganizationId,
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Switch organization"
          disabled={switching}
          render={
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0 max-w-36 shrink text-muted-foreground sm:max-w-48"
            />
          }
        >
          <span className="truncate">
            {activeOrganization?.name ?? "Organization"}
          </span>
          <ChevronDown className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {organizations.map((org) => (
            <DropdownMenuItem
              key={org.id}
              disabled={org.id === activeOrganizationId}
              onClick={() => void switchOrganization(org.id)}
            >
              {org.id === activeOrganizationId ? (
                <Check aria-hidden="true" />
              ) : (
                <span className="size-3.5" />
              )}
              <span className="truncate">{org.name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p
          role="alert"
          className="absolute top-full right-0 w-64 pt-2 text-right text-sm text-destructive"
        >
          {error}
        </p>
      )}
    </>
  );
}
