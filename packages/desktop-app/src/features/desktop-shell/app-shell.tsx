import { Card, CardContent } from "@everr/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { Bell, CircleUser, Code, LogOut, Settings } from "lucide-react";
import { invokeCommand, NOTIFICATION_HISTORY_CHANGED_EVENT } from "@/lib/tauri";
import { useInvalidateOnTauriEvent } from "@/lib/tauri-events";
import { useAuthStatusQuery, useSignOutMutation } from "../auth/auth";

export function AppShell() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_30%),linear-gradient(180deg,var(--settings-shell)_0%,var(--settings-shell-bottom)_100%)] text-[var(--settings-text)]">
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 h-9" />
      <Card className="flex flex-row h-screen w-full overflow-hidden border-[color:var(--settings-border)] bg-[var(--settings-panel)] text-[var(--settings-text)] shadow-[var(--settings-panel-shadow)] py-0">
        <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] pt-12 pb-3">
          <NotificationsLink />
          <SidebarLink to="/settings" label="Settings">
            <Settings className="size-[18px]" />
          </SidebarLink>
          {import.meta.env.DEV && (
            <SidebarLink to="/developer" label="Developer">
              <Code className="size-[18px]" />
            </SidebarLink>
          )}
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

type HistoryEntry = {
  seen: boolean;
};

const notificationHistoryQueryKey = [
  "desktop-app",
  "notification-history",
] as const;

function NotificationsLink() {
  useInvalidateOnTauriEvent(
    NOTIFICATION_HISTORY_CHANGED_EVENT,
    (queryClient) => {
      void queryClient.invalidateQueries({
        queryKey: notificationHistoryQueryKey,
      });
    },
  );

  const historyQuery = useQuery({
    queryKey: notificationHistoryQueryKey,
    queryFn: () => invokeCommand<HistoryEntry[]>("get_notification_history"),
  });

  const unreadCount = (historyQuery.data ?? []).filter((e) => !e.seen).length;

  return (
    <Link
      to="/"
      aria-label="Notifications"
      className="relative flex size-9 items-center justify-center rounded-md text-[var(--settings-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--settings-text)] [&.active]:bg-white/[0.08] [&.active]:text-[var(--settings-text)]"
    >
      <Bell className="size-[18px]" />
      {unreadCount > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[0.6rem] font-semibold leading-none text-primary-foreground">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Link>
  );
}

function AuthStatusIndicator() {
  const authStatusQuery = useAuthStatusQuery();
  const signOutMutation = useSignOutMutation();
  const signedIn = authStatusQuery.data?.status === "signed_in";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative flex size-9 cursor-pointer items-center justify-center rounded-md text-[var(--settings-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--settings-text)]"
        aria-label="Account"
      >
        <CircleUser className="size-[18px]" />
        <span
          className={`absolute bottom-1.5 right-1.5 size-2 rounded-full ring-1 ring-[var(--settings-panel)] ${signedIn ? "bg-emerald-500" : "bg-red-400"}`}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={8}>
        {signedIn ? (
          <DropdownMenuItem
            disabled={signOutMutation.isPending}
            onSelect={() => void signOutMutation.mutateAsync()}
          >
            <LogOut className="mr-2 size-4" />
            {signOutMutation.isPending ? "Signing out..." : "Sign out"}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled className="text-muted-foreground">
            Not connected
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
