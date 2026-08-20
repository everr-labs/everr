import { Button } from "@everr/ui/components/button";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelTopClose,
  PanelTopOpen,
} from "lucide-react";

/**
 * The full-screen toggle for a rail frame, seated at the left of the toolbar
 * so it costs no vertical space of its own. One control, both directions: hide
 * the rail, or bring it back. `listLabel` names what the rail lists, so the
 * runbooks frame reuses the control without borrowing the dashboards wording.
 */
export function FrameToggle({
  listLabel = "dashboard list",
}: {
  listLabel?: string;
}) {
  // Loose search read: this control mounts from several route subtrees
  // (dashboards, runbooks), where a `from`-bound read would throw.
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
      aria-label={full ? `Show the ${listLabel}` : `Hide the ${listLabel}`}
      className="text-muted-foreground"
      onClick={toggle}
    >
      {/* Below `md` the rail stacks above the content (see the route layout),
          so the icon collapses vertically there and sideways from `md` up. */}
      {full ? (
        <>
          <PanelTopOpen className="size-4 md:hidden" />
          <PanelLeftOpen className="size-4 max-md:hidden" />
        </>
      ) : (
        <>
          <PanelTopClose className="size-4 md:hidden" />
          <PanelLeftClose className="size-4 max-md:hidden" />
        </>
      )}
    </Button>
  );
}
