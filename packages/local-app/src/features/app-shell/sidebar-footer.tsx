import { ShellNavLink } from "@everr/app-shell/shell";
import { SidebarMenu } from "@everr/ui/components/sidebar";
import { Code, Settings } from "lucide-react";

export function LocalSidebarFooter() {
  return (
    <SidebarMenu className="[--nav-accent:var(--ctp-lavender)]">
      <ShellNavLink title="Settings" to="/settings" icon={Settings} />
      {import.meta.env.DEV && <ShellNavLink title="Developer" to="/developer" icon={Code} />}
    </SidebarMenu>
  );
}
