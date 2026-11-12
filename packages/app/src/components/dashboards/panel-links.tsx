import { Link, useSearch } from "@tanstack/react-router";
import { Maximize2, Minimize2 } from "lucide-react";
import type { ReactNode } from "react";

/** Where a dashboard lives in the app: the address its panel pages hang under. */
export type DashboardAddress =
  | { kind: "own"; project: string; slug: string }
  | { kind: "built-in"; slug: string };

interface AnchorProps {
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
    className: iconLinkClass,
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
export function RestorePanelLink({ address }: { address: DashboardAddress }) {
  return (
    <DashboardLink
      address={address}
      className={iconLinkClass}
      title="Back to the dashboard"
      aria-label="Back to the dashboard"
    >
      <Minimize2 className="size-3.5" />
    </DashboardLink>
  );
}
