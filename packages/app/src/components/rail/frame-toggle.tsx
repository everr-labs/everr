import { Button } from "@everr/ui/components/button";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useRailFrame } from "./rail-frame";

/**
 * The full-screen toggle for a rail frame, seated at the left of the toolbar
 * so it costs no vertical space of its own. One control, both directions: hide
 * the rail, or bring it back. On a phone the rail is a sheet, and this opens
 * it. `listLabel` names what the rail lists, so the runbooks frame reuses the
 * control without borrowing the dashboards wording.
 *
 * It sits in its own 32px row, the height of the toolbar controls beside it,
 * so it lands at the same spot on every page that shows it.
 */
export function FrameToggle({ listLabel = "dashboard list" }: { listLabel?: string }) {
  // Loose search read: this control mounts from several route subtrees
  // (dashboards, runbooks), where a `from`-bound read would throw.
  const search: { full?: boolean } = useSearch({ strict: false });
  const full = search.full ?? false;
  const frame = useRailFrame();
  const navigate = useNavigate();
  const toggle = () => {
    if (frame?.sheet) return frame.openSheet();
    // `to: "."` keeps the open dashboard; `replace` because toggling the
    // frame is a view change, not a place the back button should revisit.
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, full: !full || undefined }),
      replace: true,
    });
  };
  const hidden = full || frame?.sheet;
  return (
    <div className="flex h-8 shrink-0 items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label={hidden ? `Show the ${listLabel}` : `Hide the ${listLabel}`}
        className="text-muted-foreground max-md:size-9"
        onClick={toggle}
      >
        {hidden ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
      </Button>
    </div>
  );
}
