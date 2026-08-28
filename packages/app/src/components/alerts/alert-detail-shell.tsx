/**
 * The alerting workspace: a list that owns its scroll, and the rule detail
 * beside it.
 *
 * Triage and Silences are both lists of things that happen to rules, and both
 * answer "show me that rule" without leaving the list the reader is comparing
 * against. That makes the panel's breakpoint, its Escape key, its animation,
 * the search param it lives at and the pause it offers one contract, held here,
 * rather than a second copy on the second screen. The two had already begun to
 * drift on which reason the breakpoint exists for.
 */
import { Sheet, SheetContent, SheetTitle } from "@everr/ui/components/sheet";
import { useMediaQuery } from "@everr/ui/hooks/use-media-query";
import { cn } from "@everr/ui/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { setAlertRulePaused } from "@/data/alerting/triage/mutations";
import { invalidateAlertTriage } from "@/data/alerting/triage/options";

/** The open rule lives in the URL, so the detail survives a reload and can be
 *  pasted into an incident channel. The panel is a route, not local UI state,
 *  and it is the same URL the rule inventory and the link in a delivered
 *  notification both point at. */
export const ALERT_PANEL_SEARCH = z.object({ alert: z.string().optional() });

/**
 * What a route hosting the panel declares, beyond its own breadcrumb.
 *
 * The preview banner is suppressed because neither screen shows an as-code
 * resource a preview branch overlays: preview rules never evaluate and never
 * notify, so the frame would promise a diff that cannot exist. `fullBleed`
 * hands the page its own scroll, which is what lets the list and the panel
 * scroll independently.
 */
export const ALERT_PANEL_ROUTE = {
  hidePreviewFrame: true,
  fullBleed: true,
} as const;

/**
 * Under this there is no width to split: a detail column narrow enough to fit
 * would leave the list unreadable, so the same panel arrives as a sheet
 * instead. The Explore grids put their inspector column behind `lg` too.
 */
const NARROW_QUERY = "(max-width: 1023px)";

export const useAlertPanelIsNarrow = () => useMediaQuery(NARROW_QUERY);

/**
 * Pausing a rule, from wherever its detail is open.
 *
 * Beside the panel rather than on each route for the same reason the silence
 * writes are: both screens can reach it, and a write from either has to say the
 * same thing and refresh the same reads.
 */
export function useAlertRulePause() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setAlertRulePaused,
    onSuccess: async (result, variables) => {
      await invalidateAlertTriage(queryClient);
      toast.success(
        `${result.paused ? "Paused" : "Resumed"} ${variables.data.path}`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

/**
 * Escape closes the column.
 *
 * The column is not a modal, so nothing dismisses it for us, and Escape is what
 * a reader who just opened a rule reaches for. The sheet answers it on a narrow
 * window, so the column has to answer it on a wide one. Callers pass `active:
 * false` while a dialog is up: that dialog is the innermost thing on screen and
 * answers the key itself.
 */
export function useEscapeClosesPanel(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, onClose]);
}

/**
 * The two panes.
 *
 * `children` is the list. It must measure itself against its own column rather
 * than the window: opening the panel takes width away from it, and a viewport
 * breakpoint cannot see that happen.
 */
export function AlertDetailShell({
  panel,
  isNarrow,
  onClosePanel,
  children,
}: {
  /** `null` when no rule is open. */
  panel: React.ReactNode;
  isNarrow: boolean;
  onClosePanel: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        // Two panes that scroll independently, so the detail keeps its header
        // in place while you read down a rule and the list keeps the row you
        // clicked exactly where you left it.
        "grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)]",
        panel &&
          !isNarrow &&
          "lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_27rem] 2xl:grid-cols-[minmax(0,1fr)_31rem]",
      )}
    >
      {children}
      {isNarrow ? (
        <Sheet
          open={Boolean(panel)}
          onOpenChange={(next) => {
            if (!next) onClosePanel();
          }}
        >
          {/* The panel draws its own close button, in the same place at both
              widths, so the sheet's would be a second one beside it. */}
          <SheetContent
            showCloseButton={false}
            className="gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[30rem]"
          >
            <SheetTitle className="sr-only">Alert detail</SheetTitle>
            {panel}
          </SheetContent>
        </Sheet>
      ) : (
        panel && (
          // The column arrives from the edge it will occupy, once, at the
          // speed the app's other overlays open. Switching rules keeps the
          // same column, so it does not replay.
          <aside
            aria-label="Alert detail"
            className="animate-in fade-in slide-in-from-right-4 min-h-0 min-w-0 border-l duration-200 motion-reduce:animate-none"
          >
            {panel}
          </aside>
        )
      )}
    </div>
  );
}
