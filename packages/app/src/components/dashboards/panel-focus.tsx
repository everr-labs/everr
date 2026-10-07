import { Button } from "@everr/ui/components/button";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { cn } from "@everr/ui/lib/utils";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Check, Copy, Maximize2, Minimize2 } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { Panel } from "@/data/dashboards/schema";
import { DashboardPanel } from "./dashboard-panel";
import { useHasVisibleVariables, VariableBar } from "./variable-bar";

const INSET_SLOT = "[data-slot='sidebar-inset']";
const CANVAS_SLOT = "[data-slot='dashboard-canvas']";

function usePanelNavigation() {
  const navigate = useNavigate();
  const open = useCallback(
    (panelKey: string) => {
      // Push, so Back from the full page returns to the grid.
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, panel: panelKey }),
        replace: false,
      });
    },
    [navigate],
  );
  const close = useCallback(() => {
    // Replace, so closing does not leave the full page sitting under Back.
    void navigate({
      to: ".",
      search: (prev) => ({ ...prev, panel: undefined }),
      replace: true,
    });
  }, [navigate]);
  return { open, close };
}

/**
 * Maximize control for a grid panel. The full-page view reads `panel` from
 * the URL, so the address is the thing a colleague opens.
 */
export function OpenPanelButton({
  panelKey,
  title,
}: {
  panelKey: string;
  title: string;
}) {
  const { open } = usePanelNavigation();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground"
      aria-label={`View ${title} full page`}
      onClick={() => open(panelKey)}
    >
      <Maximize2 />
    </Button>
  );
}

function useShareUrl(): string {
  const href = useRouterState({ select: (state) => state.location.href });
  if (typeof window === "undefined") return href;
  return new URL(href, window.location.origin).href;
}

/**
 * One panel, filling the canvas under the top bar and beside the sidebar.
 *
 * Portaled onto the sidebar inset so the stage is positioned against that
 * box (the header is `fixed` and the inset is already beside the sidebar).
 * The canvas underneath is marked `inert` for the same lifetime: it stays
 * mounted, but it is not a second tab stop or a click target under the stage.
 */
export function PanelFocus({
  panelKey,
  panel,
}: {
  panelKey: string;
  panel: Panel | undefined;
}) {
  const { close } = usePanelNavigation();
  const [inset, setInset] = useState<HTMLElement | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const nextInset = document.querySelector<HTMLElement>(INSET_SLOT);
    const canvas = document.querySelector<HTMLElement>(CANVAS_SLOT);
    setInset(nextInset);
    if (!canvas) return;
    canvas.setAttribute("inert", "");
    return () => canvas.removeAttribute("inert");
  }, []);

  useLayoutEffect(() => {
    backRef.current?.focus();
  }, [inset]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        // A field commits on blur. Leave the field first; the next Escape
        // closes the page, so a draft is not thrown away by the close.
        const field = target.closest("input, textarea");
        if (field instanceof HTMLElement) {
          field.blur();
          return;
        }
        if (
          target.closest("[role='menu'], [role='listbox'], [role='dialog']")
        ) {
          return;
        }
      }
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [close]);

  if (!inset) return null;

  const title = panel?.spec.display?.name ?? panelKey;
  return createPortal(
    <section
      aria-label={panel ? title : "Panel not on this dashboard"}
      className="absolute inset-x-0 top-12 bottom-0 z-40 flex flex-col overflow-hidden overscroll-contain bg-background p-3"
    >
      <PanelFocusToolbar backRef={backRef} onClose={close} />
      <div className="min-h-0 flex-1">
        {panel ? (
          <DashboardPanel panel={panel} panelKey={panelKey} />
        ) : (
          <MissingPanel panelKey={panelKey} onClose={close} />
        )}
      </div>
    </section>,
    inset,
  );
}

function PanelFocusToolbar({
  backRef,
  onClose,
}: {
  backRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const hasVariables = useHasVisibleVariables();
  const shareUrl = useShareUrl();
  const urlRef = useRef<HTMLParagraphElement>(null);
  const { state: copyState, copy } = useCopyToClipboard(shareUrl, {
    selectOnFailure: urlRef,
  });

  return (
    <div className="mb-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
      <Button
        ref={backRef}
        type="button"
        variant="ghost"
        className="order-1 text-muted-foreground"
        onClick={onClose}
      >
        <Minimize2 />
        All panels
      </Button>
      {hasVariables && (
        <div aria-hidden className="order-2 hidden h-8 items-center sm:flex">
          <div className="h-5 w-px bg-border" />
        </div>
      )}
      <div className="order-3 min-w-0 basis-full sm:order-2 sm:flex-1 sm:basis-auto">
        <VariableBar layout="inline" />
      </div>
      <div className="order-2 ml-auto flex flex-col items-end sm:order-3">
        <Button type="button" variant="outline" onClick={copy}>
          {copyState === "copied" ? <Check /> : <Copy />}
          {copyState === "copied" ? "Copied" : "Copy link"}
        </Button>
        <p
          ref={urlRef}
          aria-hidden={copyState !== "failed"}
          className={cn(
            "max-w-full break-all font-mono text-[0.6875rem]/relaxed",
            copyState === "failed" ? "mt-1 text-foreground" : "sr-only",
          )}
        >
          {shareUrl}
        </p>
        <p
          role="status"
          className={cn(
            "text-xs",
            copyState === "failed" ? "text-amber-400" : "sr-only",
          )}
        >
          {copyState === "copied" && "Link copied."}
          {copyState === "failed" &&
            "Couldn't access the clipboard. The link is selected, so you can copy it manually."}
        </p>
      </div>
    </div>
  );
}

function MissingPanel({
  panelKey,
  onClose,
}: {
  panelKey: string;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <p className="text-sm text-foreground">
        This dashboard has no panel{" "}
        <code className="font-mono break-all">{panelKey}</code>.
      </p>
      <p className="max-w-sm text-xs/relaxed text-muted-foreground">
        The link may point at a panel that was renamed or removed.
      </p>
      <Button type="button" variant="outline" onClick={onClose}>
        All panels
      </Button>
    </div>
  );
}
