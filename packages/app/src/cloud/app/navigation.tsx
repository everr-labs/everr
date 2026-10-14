import { DropdownMenuItem } from "@everr/ui/components/dropdown-menu";
import { Link } from "@tanstack/react-router";
import { CreditCard } from "lucide-react";

export function OrganizationMenuItems() {
  return (
    <DropdownMenuItem render={<Link to="/billing" />} nativeButton={false}>
      <CreditCard />
      Plan &amp; Billing
    </DropdownMenuItem>
  );
}
