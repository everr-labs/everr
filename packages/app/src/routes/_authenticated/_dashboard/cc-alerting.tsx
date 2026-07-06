import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { PageContainer } from "@/components/page-container";
import { SegmentedTab, SegmentedTabs } from "@/components/segmented-tabs";

type CcNavItem = { label: string; to: string };

// Four intent-named destinations, collapsed from the original eight facets:
// learn the model, watch what's happening, see what's watched, configure
// delivery (delivery lives on the unified notifications page).
const NAV_ITEMS: CcNavItem[] = [
  { label: "Overview", to: "/cc-alerting/overview" },
  { label: "Monitor", to: "/cc-alerting/monitor" },
  { label: "Rules", to: "/cc-alerting/rules" },
  { label: "Notifications", to: "/alerts/notifications" },
];

export const Route = createFileRoute("/_authenticated/_dashboard/cc-alerting")({
  staticData: { breadcrumb: "Advanced alerting", hideTimeRangePicker: true },
  head: () => ({ meta: [{ title: "Everr - Advanced Alerting" }] }),
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
          <h1 className="text-xl font-bold tracking-tight">
            Advanced alerting
          </h1>
          <SegmentedTabs label="Advanced alerting sections">
            {NAV_ITEMS.map((item) => (
              <SegmentedTab
                key={item.to}
                active={isActive(item.to)}
                render={<Link to={item.to} />}
              >
                {item.label}
              </SegmentedTab>
            ))}
          </SegmentedTabs>
        </div>
        <Outlet />
      </PageContainer>
    </div>
  );
}
