import { Card, CardContent } from "@everr/ui/components/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import { ScrollArea } from "@everr/ui/components/scroll-area";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import {
  Bug,
  CircleUser,
  Code,
  GitPullRequestArrow,
  LogIn,
  LogOut,
  ScrollText,
  Settings,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { OPEN_SETTINGS_EVENT } from "../../lib/tauri";
import { useIsFullscreen, useTauriEvent } from "../../lib/tauri-events";
import {
  useAuthStatusQuery,
  useOrgQuery,
  useSignInMutation,
  useSignOutMutation,
  useUserProfileQuery,
} from "../auth/auth";
import { AppUpdateButton } from "./app-update";
import { TitleBarSlotsContext } from "./title-bar";

export function AppShell() {
  useIsFullscreen();
  const navigate = useNavigate();
  // Tray "Settings" item emits this after showing the window; route to /settings.
  useTauriEvent(OPEN_SETTINGS_EVENT, () => {
    void navigate({ to: "/settings" });
  });

  // Portal targets for the single top title bar. Pages render their title +
  // controls into these via PageTitleBar, so the bar spans the whole window
  // top and the nav below it keeps a fixed position in fullscreen and not.
  const [titleLeft, setTitleLeft] = useState<HTMLElement | null>(null);
  const [titleRight, setTitleRight] = useState<HTMLElement | null>(null);

  return (
    <main className="h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_30%),linear-gradient(180deg,var(--settings-shell)_0%,var(--settings-shell-bottom)_100%)] text-[var(--settings-text)]">
      <Card className="flex h-screen w-full flex-col gap-0 overflow-hidden border-[color:var(--settings-border)] bg-[var(--settings-panel)] py-0 text-[var(--settings-text)] shadow-[var(--settings-panel-shadow)]">
        <header className="relative z-10 flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.06]">
          {/* Left: traffic-light clearance + page title; the empty space stays a
              window drag handle. The inset collapses to 0 in fullscreen. */}
          <div
            ref={setTitleLeft}
            data-tauri-drag-region
            className="flex min-w-0 flex-1 items-center self-stretch gap-2 pl-[var(--titlebar-inset)] pr-2"
          />
          {/* Right: page controls (time range, refresh) — interactive, not a drag region. */}
          <div
            ref={setTitleRight}
            className="flex shrink-0 items-center gap-1.5 pr-3"
          />
        </header>

        <TitleBarSlotsContext.Provider
          value={{ left: titleLeft, right: titleRight }}
        >
          <div className="flex min-h-0 flex-1 flex-row">
            <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] pt-2 pb-3">
              <SidebarLink to="/logs" label="Logs">
                <ScrollText className="size-[18px]" />
              </SidebarLink>
              <SidebarLink to="/traces" label="Traces">
                <Workflow className="size-[18px]" />
              </SidebarLink>
              <SidebarLink to="/errors" label="Errors">
                <Bug className="size-[18px]" />
              </SidebarLink>
              <NotificationsLink />
              <SidebarLink to="/settings" label="Settings">
                <Settings className="size-[18px]" />
              </SidebarLink>
              {import.meta.env.DEV && (
                <SidebarLink to="/developer" label="Developer">
                  <Code className="size-[18px]" />
                </SidebarLink>
              )}
              <div className="mt-auto flex flex-col items-center gap-1.5">
                <AppUpdateButton />
                <AuthStatusIndicator />
              </div>
            </nav>
            <CardContent className="min-w-0 flex-1 p-0">
              {/* overscroll-none dropped: some panes (Settings, Developer) fit
                  without scrolling, and it would swallow wheel events there. */}
              <ScrollArea className="size-full">
                <Outlet />
              </ScrollArea>
            </CardContent>
          </div>
        </TitleBarSlotsContext.Provider>
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

function NotificationsLink() {
  return (
    <Link
      to="/ci"
      aria-label="Your CI runs"
      className="relative flex size-9 items-center justify-center rounded-md text-[var(--settings-text-muted)] transition-colors hover:bg-white/[0.06] hover:text-[var(--settings-text)] [&.active]:bg-white/[0.08] [&.active]:text-[var(--settings-text)]"
    >
      <GitPullRequestArrow className="size-[18px]" />
    </Link>
  );
}

function AuthStatusIndicator() {
  const navigate = useNavigate();
  const authStatusQuery = useAuthStatusQuery();
  const signInMutation = useSignInMutation();
  const signOutMutation = useSignOutMutation();
  const signedIn = authStatusQuery.data?.status === "signed_in";
  const profileQuery = useUserProfileQuery(signedIn);
  const orgQuery = useOrgQuery(signedIn);
  const profile = profileQuery.data;
  const orgName = orgQuery.data?.name;
  const displayName = profile?.name || profile?.email;

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
      <DropdownMenuContent
        side="right"
        align="end"
        sideOffset={8}
        className="min-w-[220px] max-w-[280px]"
      >
        {signedIn && (displayName || orgName) ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="grid gap-0.5">
                {displayName ? (
                  <span className="truncate text-sm font-medium text-[var(--settings-text)]">
                    {displayName}
                  </span>
                ) : null}
                {orgName ? (
                  <span className="truncate text-xs font-normal text-[var(--settings-text-muted)]">
                    {orgName}
                  </span>
                ) : null}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {signedIn ? (
          <DropdownMenuItem
            disabled={signOutMutation.isPending}
            render={
              <button
                type="button"
                className="w-full"
                onClick={() => void signOutMutation.mutateAsync()}
              >
                <LogOut className="mr-2 size-4" />
                Sign out
              </button>
            }
          />
        ) : (
          <DropdownMenuItem
            disabled={signInMutation.isPending}
            render={
              <button
                type="button"
                className="w-full"
                onClick={() => {
                  void signInMutation.mutateAsync();
                  void navigate({ to: "/settings" });
                }}
              >
                <LogIn className="mr-2 size-4" />
                Sign in
              </button>
            }
          />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
