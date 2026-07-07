import { cn } from "@everr/ui/lib/utils";
import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";

const TABS = [
  { label: "Active", to: "/alerts/monitor/active" },
  { label: "Stream", to: "/alerts/monitor/stream" },
  { label: "Silences", to: "/alerts/monitor/silences" },
] as const;

export const Route = createFileRoute(
  "/_authenticated/_dashboard/alerts/monitor",
)({
  staticData: { breadcrumb: "Monitor" },
  head: () => ({ meta: [{ title: "Everr - Alerts Monitor" }] }),
  component: CcMonitorLayout,
});

function CcMonitorLayout() {
  const { pathname } = useLocation();

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Monitor view"
        className="inline-flex rounded-md border border-border bg-muted/20 p-0.5"
      >
        {TABS.map((tab) => {
          const active = pathname === tab.to;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              role="tab"
              aria-selected={active}
              className={cn(
                "rounded-[0.3rem] px-3 py-1 text-xs font-medium outline-2 outline-dotted outline-transparent outline-offset-[-2px] transition-colors duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] focus-visible:outline-primary",
                active
                  ? "bg-card text-foreground ring-1 ring-foreground/10"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <Outlet />
    </div>
  );
}
