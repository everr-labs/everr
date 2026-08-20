import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import {
  groupLabelClass,
  railRowClass,
} from "@/components/dashboards/dashboard-tree";
import type { PageNavNode } from "@/data/runbooks/pages";
import type { OpenRunbook, OpenRunbookPages } from "./use-open-runbook";

/** Each nesting level of pages steps in by this much past the one above. */
const PAGE_STEP = 12;

/**
 * The look of one page link. Active state is decided by the caller rather than
 * by `activeProps`: a splat route's active state depends on the whole
 * remaining path, and the route already knows it exactly. The indent only
 * applies once the nav stands up as a column.
 */
function pageLinkProps(depth: number, active: boolean) {
  return {
    style: { "--page-indent": `${depth * PAGE_STEP}px` } as CSSProperties,
    className: cn(
      railRowClass,
      "block shrink-0 truncate px-2 text-muted-foreground text-sm max-md:py-1 md:pl-[calc(0.5rem+var(--page-indent))]",
      active && "bg-muted font-medium text-foreground",
    ),
    "aria-current": active ? ("page" as const) : undefined,
  };
}

/**
 * The second navigation level: the pages inside the open runbook. It is its
 * own column, bordered off from the runbook rail, so the two never read as one
 * list. Below `md` it lies down into a scrolling strip of links instead, where
 * a second stacked column would eat the screen.
 */
export function RunbookPagesRail({
  open,
  pages,
}: {
  open: OpenRunbook;
  pages: OpenRunbookPages;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5">
      <h2 className={cn(groupLabelClass, "px-2 max-md:hidden")}>Pages</h2>
      <nav
        aria-label="Runbook pages"
        className="flex min-h-0 flex-1 gap-0.5 overflow-y-auto pr-1 pb-2 max-md:items-center max-md:overflow-x-auto max-md:pb-0 md:flex-col"
      >
        <Link
          to="/runbooks/$project/$slug"
          params={{ project: open.project, slug: open.slug }}
          {...pageLinkProps(0, open.path === "")}
        >
          {pages.indexTitle}
        </Link>
        {pages.tree.map((node) => (
          <PageRows key={node.path} node={node} depth={1} open={open} />
        ))}
      </nav>
    </div>
  );
}

function PageRows({
  node,
  depth,
  open,
}: {
  node: PageNavNode;
  depth: number;
  open: OpenRunbook;
}) {
  return (
    <>
      <Link
        to="/runbooks/$project/$slug/$"
        params={{ project: open.project, slug: open.slug, _splat: node.path }}
        {...pageLinkProps(depth, open.path === node.path)}
      >
        {node.title}
      </Link>
      {node.children.map((child) => (
        <PageRows key={child.path} node={child} depth={depth + 1} open={open} />
      ))}
    </>
  );
}
