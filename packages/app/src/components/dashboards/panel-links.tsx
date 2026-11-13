import { Link, type LinkProps, useSearch } from "@tanstack/react-router";
import { Maximize2, Minimize2 } from "lucide-react";
import {
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";

/** Where a dashboard lives in the app: the address its panel pages hang under. */
export type DashboardAddress =
  | { kind: "own"; project: string; slug: string }
  | { kind: "built-in"; slug: string };

/**
 * The panel that morphs: only it takes a view-transition name, so the rest of
 * the grid stays in the root snapshot and fades under the morph. The grid reads
 * it from here, so every way into the morph (the two links, the browser's back
 * and forward) can mark the panel before the page is captured. Kept after the
 * morph: the names are only given while a panel transition runs, so a stale
 * mark is inert.
 */
let movingPanel: string | undefined;
const movingPanelListeners = new Set<() => void>();

function subscribeMovingPanel(listener: () => void) {
  movingPanelListeners.add(listener);
  return () => {
    movingPanelListeners.delete(listener);
  };
}

function setMovingPanel(panelKey: string) {
  if (movingPanel === panelKey) return;
  movingPanel = panelKey;
  // Synchronous: a mounted grid has to name the panel before the capture.
  flushSync(() => {
    for (const listener of movingPanelListeners) listener();
  });
}

export function useMovingPanel() {
  return useSyncExternalStore(
    subscribeMovingPanel,
    () => movingPanel,
    () => undefined,
  );
}

/**
 * Typed, so the styles in dashboard-grid.css apply to this morph only and not
 * to other view transitions (the command bar's); the second type sets the
 * direction, since going back runs shorter than opening.
 */
const maximizeTypes = ["dashboard-panel", "dashboard-panel-maximize"];
const restoreTypes = ["dashboard-panel", "dashboard-panel-restore"];

/**
 * The grid path and panel key of a maximized-panel path, if it is one. Runs
 * inside the router's navigation, so a key that doesn't decode is just not a
 * panel route rather than a throw.
 */
function panelRoute(pathname: string | undefined) {
  const match = pathname && /^(\/dashboards\/.+)\/panel\/([^/]+)$/.exec(pathname);
  if (!match?.[1] || !match[2]) return undefined;
  try {
    return { grid: match[1], key: decodeURIComponent(match[2]) };
  } catch {
    return undefined;
  }
}

/**
 * The router's default view transition, for the navigations no link starts:
 * the browser's back and forward between a grid and one of its panels morph
 * like the links do. Every other navigation keeps going without one.
 */
const panelHistoryTypes = {
  types: ({
    fromLocation,
    toLocation,
  }: {
    fromLocation?: { pathname: string };
    toLocation: { pathname: string };
  }) => {
    const opening = panelRoute(toLocation.pathname);
    if (opening && opening.grid === fromLocation?.pathname) {
      setMovingPanel(opening.key);
      return maximizeTypes;
    }
    const closing = panelRoute(fromLocation?.pathname);
    if (closing && closing.grid === toLocation.pathname) {
      setMovingPanel(closing.key);
      return restoreTypes;
    }
    return false;
  },
};

/**
 * The router only asks `types` where the browser supports typed transitions;
 * elsewhere any default would run untyped on every navigation, so there is none.
 */
export function panelHistoryViewTransition() {
  // The router's own check, which also holds where CSS lacks supports (jsdom).
  return typeof window !== "undefined" &&
    window.CSS?.supports?.("selector(:active-view-transition-type(a))")
    ? panelHistoryTypes
    : false;
}

/**
 * The grid remounts on restore, and the pane it scrolls in shrinks to one
 * screen while the panel is maximized, so the scroll offset is lost both ways.
 * Maximize stashes it per dashboard; restore hands the grid the offset of the
 * page it is going back to, and the grid takes it once.
 */
const gridScroll = new Map<string, number>();
let restoringScroll: { pathname: string; top: number } | undefined;

function scrollPane(element: Element | null) {
  return element?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]') ?? null;
}

/**
 * Puts the grid back where it was scrolled before maximizing. A layout effect,
 * so it lands before the browser captures the new page and the panel morphs
 * to where it really is; the grid's height doesn't wait on its width, so the
 * offset fits on the first commit.
 */
export function useRestoredGridScroll(gridRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const restoring = restoringScroll;
    restoringScroll = undefined;
    // Only on the page the restore was headed to: a restore that never landed
    // must not move whichever grid mounts next.
    if (restoring?.pathname !== window.location.pathname) return;
    const pane = scrollPane(gridRef.current);
    if (pane) pane.scrollTop = restoring.top;
  }, [gridRef]);
}

interface AnchorProps {
  viewTransition?: LinkProps["viewTransition"];
  resetScroll?: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
  title?: string;
  "aria-label"?: string;
  children: ReactNode;
}

const iconLinkClass =
  "flex rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2";

/**
 * `vars` is not retained across navigation (other dashboards have other
 * variables), so the links between a dashboard and its own panels carry it by
 * hand: the maximized panel has to draw the same data the grid did.
 */
function useVarsSearch() {
  const { vars } = useSearch({ from: "/_authenticated/_organization/_dashboard" });
  return { vars };
}

/** Link to the dashboard's grid. */
export function DashboardLink({ address, ...anchor }: AnchorProps & { address: DashboardAddress }) {
  const search = useVarsSearch();
  return address.kind === "own" ? (
    <Link
      to="/dashboards/$project/$slug"
      params={{ project: address.project, slug: address.slug }}
      search={search}
      {...anchor}
    />
  ) : (
    <Link
      to="/dashboards/built-in/$slug"
      params={{ slug: address.slug }}
      search={search}
      {...anchor}
    />
  );
}

/** Header link from a panel in the grid to the page where it fills the pane. */
export function MaximizePanelLink({
  address,
  panelKey,
  title,
}: {
  address: DashboardAddress;
  panelKey: string;
  title: string;
}) {
  const search = useVarsSearch();
  const anchor = {
    viewTransition: { types: maximizeTypes },
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      const pane = scrollPane(event.currentTarget);
      if (pane) gridScroll.set(window.location.pathname, pane.scrollTop);
      // Before the router captures the page, so the panel is named in it.
      setMovingPanel(panelKey);
    },
    // Revealed on hover where there is hover to reveal it (a fine pointer that
    // hovers); other devices keep it showing, and keyboard focus always shows it.
    className: `${iconLinkClass} transition-opacity duration-150 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover/panel:opacity-100 focus-visible:opacity-100`,
    title: "Maximize",
    "aria-label": `Maximize ${title}`,
    children: <Maximize2 className="size-3.5" />,
  };
  return address.kind === "own" ? (
    <Link
      to="/dashboards/$project/$slug/panel/$panelKey"
      params={{ project: address.project, slug: address.slug, panelKey }}
      search={search}
      {...anchor}
    />
  ) : (
    <Link
      to="/dashboards/built-in/$slug/panel/$panelKey"
      params={{ slug: address.slug, panelKey }}
      search={search}
      {...anchor}
    />
  );
}

/** The way back from a maximized panel to its dashboard grid. */
export function RestorePanelLink({
  address,
  panelKey,
}: {
  address: DashboardAddress;
  panelKey: string;
}) {
  return (
    <DashboardLink
      address={address}
      viewTransition={{ types: restoreTypes }}
      // The router would scroll the pane to the top after the grid has put
      // itself back (see useRestoredGridScroll).
      resetScroll={false}
      onClick={(event) => {
        setMovingPanel(panelKey);
        const { pathname } = event.currentTarget;
        const top = gridScroll.get(pathname);
        restoringScroll = top === undefined ? undefined : { pathname, top };
      }}
      className={iconLinkClass}
      title="Back to the dashboard"
      aria-label="Back to the dashboard"
    >
      <Minimize2 className="size-3.5" />
    </DashboardLink>
  );
}
