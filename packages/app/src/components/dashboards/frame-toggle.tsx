import { Button } from "@everr/ui/components/button";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

/**
 * The full-screen toggle for the dashboards frame, seated at the left of the
 * grid toolbar so it costs no vertical space of its own. One control, both
 * directions: hide the dashboard list, or bring it back.
 */
export function FrameToggle() {
  // Loose search read: DashboardGrid mounts from routes outside the dashboards
  // subtree (runbook embeds), where a `from`-bound read would throw.
  const search: { full?: boolean } = useSearch({ strict: false });
  const full = search.full ?? false;
  const navigate = useNavigate();
  const toggle = () =>
    // `to: "."` keeps the open dashboard; `replace` because toggling the
    // frame is a view change, not a place the back button should revisit.
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, full: !full || undefined }),
      replace: true,
    });
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={full ? "Show the dashboard list" : "Hide the dashboard list"}
      className="text-muted-foreground"
      onClick={toggle}
    >
      {full ? (
        <PanelLeftOpen className="size-4" />
      ) : (
        <PanelLeftClose className="size-4" />
      )}
    </Button>
  );
}
