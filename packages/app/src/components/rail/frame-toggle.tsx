import { Button } from "@everr/ui/components/button";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen, PanelTopClose, PanelTopOpen } from "lucide-react";
import { useRailFrame } from "./rail-frame";

/** Matches Tailwind's `md`, where the rail moves beside the pane. */
const NARROW_QUERY = "(max-width: 47.999rem)";

/**
 * The full-screen toggle for a rail frame, seated at the left of the toolbar
 * so it costs no vertical space of its own. One control, both directions: hide
 * the rail, or bring it back. `listLabel` names what the rail lists, so the
 * runbooks frame reuses the control without borrowing the dashboards wording.
 */
export function FrameToggle({ listLabel = "dashboard list" }: { listLabel?: string }) {
  // Loose search read: this control mounts from several route subtrees
  // (dashboards, runbooks), where a `from`-bound read would throw.
  const search: { full?: boolean } = useSearch({ strict: false });
  const full = search.full ?? false;
  const frame = useRailFrame();
  const collapsedOnNarrow = frame?.collapsedOnNarrow ?? false;
  const navigate = useNavigate();
  const toggle = () => {
    // Read at click time: which layout is showing only matters to the press.
    // Below `md` a collapsing frame opens its sheet, which closes itself.
    if (collapsedOnNarrow && frame && window.matchMedia(NARROW_QUERY).matches) {
      frame.openSheet();
      return;
    }
    // `to: "."` keeps the open dashboard; `replace` because toggling the
    // frame is a view change, not a place the back button should revisit.
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, full: !full || undefined }),
      replace: true,
    });
  };
  const label = (hidden: boolean) => (hidden ? `Show the ${listLabel}` : `Hide the ${listLabel}`);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      // Each layout names its own state; the hidden span keeps the other one
      // out of the accessible name.
      className="text-muted-foreground max-md:size-9"
      onClick={toggle}
    >
      {/* Below `md` the rail either opens as a sheet over the page (a
          collapsing frame, always hidden until then) or stacks above the
          content, so the icon collapses vertically there. */}
      <span className="md:hidden">
        <span className="sr-only">{label(collapsedOnNarrow || full)}</span>
        {collapsedOnNarrow ? (
          <PanelLeftOpen aria-hidden className="size-4" />
        ) : full ? (
          <PanelTopOpen aria-hidden className="size-4" />
        ) : (
          <PanelTopClose aria-hidden className="size-4" />
        )}
      </span>
      <span className="max-md:hidden">
        <span className="sr-only">{label(full)}</span>
        {full ? (
          <PanelLeftOpen aria-hidden className="size-4" />
        ) : (
          <PanelLeftClose aria-hidden className="size-4" />
        )}
      </span>
    </Button>
  );
}
