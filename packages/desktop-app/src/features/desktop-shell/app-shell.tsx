import { Card, CardContent } from "@everr/ui/components/card";
import { Link, Outlet } from "@tanstack/react-router";
import { Bell, Settings } from "lucide-react";

export function AppShell() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_30%),linear-gradient(180deg,var(--settings-shell)_0%,var(--settings-shell-bottom)_100%)] text-[var(--settings-text)]">
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 h-9" />
      <Card className="flex h-screen w-full overflow-hidden border-[color:var(--settings-border)] bg-[var(--settings-panel)] text-[var(--settings-text)] shadow-[var(--settings-panel-shadow)]">
        <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] pt-12">
          <SidebarLink to="/" label="Notifications">
            <Bell className="size-[18px]" />
          </SidebarLink>
          <SidebarLink to="/settings" label="Settings">
            <Settings className="size-[18px]" />
          </SidebarLink>
        </nav>
        <CardContent className="min-w-0 flex-1 overflow-y-auto p-0">
          <Outlet />
        </CardContent>
      </Card>
    </main>
  );
}

function SidebarLink({
  to,
  label,
  children,
}: {
  to: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      className="flex size-9 items-center justify-center rounded-md text-[var(--settings-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--settings-text)] [&.active]:bg-white/[0.08] [&.active]:text-[var(--settings-text)]"
    >
      {children}
    </Link>
  );
}
