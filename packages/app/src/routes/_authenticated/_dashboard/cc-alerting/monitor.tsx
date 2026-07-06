import {
  createFileRoute,
  Link,
  Outlet,
  useLocation,
} from "@tanstack/react-router";
import { SegmentedTab, SegmentedTabs } from "@/components/segmented-tabs";

const TABS = [
  { label: "Active", to: "/cc-alerting/monitor/active" },
  { label: "Stream", to: "/cc-alerting/monitor/stream" },
  { label: "Mutes", to: "/cc-alerting/monitor/silences" },
] as const;

export const Route = createFileRoute(
  "/_authenticated/_dashboard/cc-alerting/monitor",
)({
  staticData: { breadcrumb: "Monitor" },
  head: () => ({ meta: [{ title: "Everr - Advanced Alerting Monitor" }] }),
  component: CcMonitorLayout,
});

function CcMonitorLayout() {
  const { pathname } = useLocation();

  return (
    <div className="space-y-3">
      <SegmentedTabs label="Monitor view">
        {TABS.map((tab) => (
          <SegmentedTab
            key={tab.to}
            active={pathname === tab.to}
            render={<Link to={tab.to} />}
          >
            {tab.label}
          </SegmentedTab>
        ))}
      </SegmentedTabs>

      <Outlet />
    </div>
  );
}
