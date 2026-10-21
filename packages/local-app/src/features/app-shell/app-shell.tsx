import { Card, CardContent } from "@everr/ui/components/card";
import { ScrollArea } from "@everr/ui/components/scroll-area";
import { Link, Outlet } from "@tanstack/react-router";
import { Bug, Code, ScrollText, Settings, Workflow } from "lucide-react";
import { useState } from "react";
import { TitleBarSlotsContext } from "./title-bar";

export function AppShell() {
  // Portal targets for the single top title bar. Pages render their title +
  // controls into these via PageTitleBar, so the header and navigation keep their position across pages.
  const [titleLeft, setTitleLeft] = useState<HTMLElement | null>(null);
  const [titleRight, setTitleRight] = useState<HTMLElement | null>(null);

  return (
    <main className="h-screen overflow-hidden bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_30%),linear-gradient(180deg,var(--settings-shell)_0%,var(--settings-shell-bottom)_100%)] text-[var(--settings-text)]">
      <Card className="flex h-screen w-full flex-col gap-0 overflow-hidden border-[color:var(--settings-border)] bg-[var(--settings-panel)] py-0 text-[var(--settings-text)] shadow-[var(--settings-panel-shadow)]">
        <header className="relative z-10 flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.06]">
          <div
            ref={setTitleLeft}
            className="flex min-w-0 flex-1 items-center self-stretch gap-2 pl-[var(--titlebar-inset)] pr-2"
          />
          {/* Page controls, including time range and refresh. */}
          <div ref={setTitleRight} className="flex shrink-0 items-center gap-1.5 pr-3" />
        </header>

        <TitleBarSlotsContext.Provider value={{ left: titleLeft, right: titleRight }}>
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
              <SidebarLink to="/settings" label="Settings">
                <Settings className="size-[18px]" />
              </SidebarLink>
              {import.meta.env.DEV && (
                <SidebarLink to="/developer" label="Developer">
                  <Code className="size-[18px]" />
                </SidebarLink>
              )}
            </nav>
            <CardContent className="min-w-0 flex-1 p-0">
              {/* No overscroll-none: the ancestor main and Card are both
                  h-screen/overflow-hidden, so there is no window scroll to
                  chain to and nothing for it to guard. */}
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
