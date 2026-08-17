import { Button } from "@everr/ui/components/button";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { PanelLeftOpen } from "lucide-react";

/**
 * The way back from full screen, seated at the left of the grid's toolbar so
 * it costs no vertical space of its own. Renders nothing outside full mode:
 * the rail header carries the hide control there.
 */
export function FrameRestore() {
  const { full } = useSearch({ strict: false }) as { full?: boolean };
  const navigate = useNavigate();
  if (!full) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Show the dashboard list"
      className="text-muted-foreground"
      onClick={() =>
        void navigate({
          to: ".",
          search: (prev) => ({ ...prev, full: undefined }),
          replace: true,
        })
      }
    >
      <PanelLeftOpen className="size-4" />
    </Button>
  );
}
