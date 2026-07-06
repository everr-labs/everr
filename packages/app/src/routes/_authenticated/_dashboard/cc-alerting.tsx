import { cn } from "@everr/ui/lib/utils";
import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { PageContainer } from "@/components/page-container";

type CcNavItem = { label: string; to: string };

// Four intent-named destinations, collapsed from the original eight facets:
// learn the model, watch what's happening, see what's watched, configure delivery.
const NAV_ITEMS: CcNavItem[] = [
  { label: "Overview", to: "/cc-alerting/overview" },
  { label: "Monitor", to: "/cc-alerting/monitor" },
  { label: "Rules", to: "/cc-alerting/rules" },
  { label: "Routing", to: "/cc-alerting/routing" },
];

export const Route = createFileRoute("/_authenticated/_dashboard/cc-alerting")({
  staticData: { breadcrumb: "Clickety-Clack", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Clickety-Clack" }] }),
  component: CcAlertingLayout,
});

function CcAlertingLayout() {
  const { pathname } = useLocation();
  // `/cc-alerting/rules/$ruleId` should keep the "Rules" facet lit.
  const isActive = (to: string) =>
    pathname === to || pathname.startsWith(`${to}/`);

  // The shared `_dashboard` column is `overflow-hidden`; like `_padded`, this
  // layout owns its own scroll so tall pages (routing, rule detail) scroll
  // instead of clipping.
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto overscroll-y-contain">
      <PageContainer>
        <div className="flex flex-col gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Clickety-Clack</h1>
            <p className="text-sm text-muted-foreground">
              Prometheus-style alerting over your telemetry — rules, routing,
              and silences, evaluated against ClickHouse.
            </p>
          </div>
          <nav
            aria-label="Clickety-Clack sections"
            className="flex flex-wrap items-center gap-1 border-b border-border pb-3"
          >
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium outline-2 outline-dotted outline-transparent outline-offset-2 transition-colors duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] focus-visible:outline-primary",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <Outlet />
      </PageContainer>
    </div>
  );
}
