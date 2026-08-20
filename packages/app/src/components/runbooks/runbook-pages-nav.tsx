import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";
import type { PageNavNode } from "@/data/runbooks/pages";
import {
  FloatingMarginNav,
  floatingLinkActiveClass,
  floatingLinkClass,
  noMarginClass,
} from "./floating-margin-nav";

/** Each nesting level of pages steps in by this much past the one above. */
const PAGE_STEP = 12;

interface PagesNavProps {
  project: string;
  slug: string;
  /** The runbook's own name: the label of its index page. */
  indexTitle: string;
  tree: PageNavNode[];
  /** "" = the index page. */
  activePath: string;
}

/**
 * The navigation inside one runbook. It has no rail of its own: it floats in
 * the margin left of the reading column. Where the pane is too narrow for a
 * margin, the same links lie down into a scrolling strip above the runbook.
 */
export function RunbookPagesNav(props: PagesNavProps) {
  return (
    <>
      <nav
        aria-label="Runbook pages"
        className={cn(
          "-mx-1 mb-5 flex items-center gap-0.5 overflow-x-auto pb-1",
          noMarginClass,
        )}
      >
        <PageLinks {...props} inline />
      </nav>
      <FloatingMarginNav label="Pages" ariaLabel="Runbook pages">
        <PageLinks {...props} />
      </FloatingMarginNav>
    </>
  );
}

function PageLinks({
  project,
  slug,
  indexTitle,
  tree,
  activePath,
  inline,
}: PagesNavProps & { inline?: boolean }) {
  return (
    <>
      <PageLink
        to="/runbooks/$project/$slug"
        params={{ project, slug }}
        depth={0}
        active={activePath === ""}
        inline={inline}
      >
        {indexTitle}
      </PageLink>
      {tree.map((node) => (
        <PageRows
          key={node.path}
          node={node}
          depth={1}
          project={project}
          slug={slug}
          activePath={activePath}
          inline={inline}
        />
      ))}
    </>
  );
}

function PageRows({
  node,
  depth,
  project,
  slug,
  activePath,
  inline,
}: {
  node: PageNavNode;
  depth: number;
  project: string;
  slug: string;
  activePath: string;
  inline?: boolean;
}) {
  return (
    <>
      <PageLink
        to="/runbooks/$project/$slug/$"
        params={{ project, slug, _splat: node.path }}
        depth={depth}
        active={activePath === node.path}
        inline={inline}
      >
        {node.title}
      </PageLink>
      {node.children.map((child) => (
        <PageRows
          key={child.path}
          node={child}
          depth={depth + 1}
          project={project}
          slug={slug}
          activePath={activePath}
          inline={inline}
        />
      ))}
    </>
  );
}

type PageLinkTarget =
  | {
      to: "/runbooks/$project/$slug";
      params: { project: string; slug: string };
    }
  | {
      to: "/runbooks/$project/$slug/$";
      params: { project: string; slug: string; _splat: string };
    };

/**
 * Active state is decided by the caller, not by `activeProps`: a splat route's
 * active state depends on the whole remaining path, and the viewer already
 * knows it exactly.
 */
function PageLink({
  depth,
  active,
  inline,
  children,
  ...target
}: {
  depth: number;
  active: boolean;
  inline?: boolean;
  children: ReactNode;
} & PageLinkTarget) {
  return (
    <Link
      {...target}
      // Depth is an indent only in the floating column; the strip is flat.
      style={
        inline
          ? undefined
          : ({ paddingLeft: `${depth * PAGE_STEP + 8}px` } as CSSProperties)
      }
      className={cn(
        floatingLinkClass,
        // Floating, a page name wraps rather than being cut: runbook page
        // names are the kind that differ at the end. Lying down, the strip
        // scrolls sideways, so its entries stay on one line.
        inline
          ? "shrink-0 whitespace-nowrap px-2 hover:bg-muted/50"
          : "block pr-2",
        active && floatingLinkActiveClass,
        active && inline && "bg-muted",
      )}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
