import { Card, CardContent } from "@everr/ui/components/card";
import { Link, Outlet } from "@tanstack/react-router";
import { Bell, CircleUser, Settings } from "lucide-react";
import { useAuthStatusQuery } from "../auth/auth";

export function AppShell() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_30%),linear-gradient(180deg,var(--settings-shell)_0%,var(--settings-shell-bottom)_100%)] text-[var(--settings-text)]">
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 h-9" />
      <Card className="flex flex-row h-screen w-full overflow-hidden border-[color:var(--settings-border)] bg-[var(--settings-panel)] text-[var(--settings-text)] shadow-[var(--settings-panel-shadow)] py-0">
        <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] pt-12 pb-3">
          <SidebarLink to="/" label="Notifications">
            <Bell className="size-[18px]" />
          </SidebarLink>
          <SidebarLink to="/settings" label="Settings">
            <Settings className="size-[18px]" />
          </SidebarLink>
          <div className="mt-auto">
            <AuthStatusIndicator />
          </div>
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

function AuthStatusIndicator() {
  const authStatusQuery = useAuthStatusQuery();
  const signedIn = authStatusQuery.data?.status === "signed_in";

  return (
    <div
      className="relative flex size-9 items-center justify-center"
      title={signedIn ? "Connected" : "Not connected"}
    >
      <CircleUser className="size-[18px] text-[var(--settings-text-muted)]" />
      <span
        className={`absolute bottom-1.5 right-1.5 size-2 rounded-full ring-1 ring-[var(--settings-panel)] ${signedIn ? "bg-emerald-500" : "bg-red-400"}`}
      />
    </div>
  );
}
