import { cn } from "@everr/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  railRowClass,
  rowLabelIndent,
} from "@/components/dashboards/dashboard-tree";
import { runbookOptions } from "@/data/runbooks/options";
import { type PageNavNode, pageNavTree } from "@/data/runbooks/pages";

/** Each nesting level of pages steps in by this much past the one above. */
const PAGE_STEP = 14;

/**
 * The pages of the open runbook, as rail rows under its own row. Only the open
 * runbook expands, so the rail carries one page tree at a time and never turns
 * into a second navigation column beside the reading pane.
 *
 * The route loader has already put the runbook in the cache, so this reads it
 * rather than fetching: the rail must never suspend the frame it lives in.
 */
export function RunbookPageRows({
  project,
  slug,
  preview,
  activePath,
  rowDepth,
}: {
  project: string;
  slug: string;
  preview?: string;
  /** "" = the runbook's own index page. */
  activePath: string;
  /** Depth of the runbook's row in the tree, so pages align under its title. */
  rowDepth: number;
}) {
  const { data } = useQuery(runbookOptions(project, slug, preview));
  if (!data) return null;
  const tree = pageNavTree(data.document.spec);
  if (tree.length === 0) return null;
  return (
    <div className="flex flex-col">
      {tree.map((node) => (
        <PageRow
          key={node.path}
          node={node}
          depth={0}
          project={project}
          slug={slug}
          activePath={activePath}
          indent={rowLabelIndent(rowDepth)}
        />
      ))}
    </div>
  );
}

function PageRow({
  node,
  depth,
  project,
  slug,
  activePath,
  indent,
}: {
  node: PageNavNode;
  depth: number;
  project: string;
  slug: string;
  activePath: string;
  indent: number;
}) {
  // Matched here rather than through `activeProps`: a splat route's active
  // state depends on the whole remaining path, and the rail knows it exactly.
  const active = activePath === node.path;
  return (
    <>
      <Link
        to="/runbooks/$project/$slug/$"
        params={{ project, slug, _splat: node.path }}
        style={{ paddingLeft: `${indent + depth * PAGE_STEP}px` }}
        className={cn(
          railRowClass,
          // Pages sit a step below their runbook: shorter rows, quieter text.
          "block truncate py-1 pr-1 text-[0.8125rem] text-muted-foreground",
          active && "bg-muted font-medium text-foreground",
        )}
        aria-current={active ? "page" : undefined}
      >
        {node.title}
      </Link>
      {node.children.map((child) => (
        <PageRow
          key={child.path}
          node={child}
          depth={depth + 1}
          project={project}
          slug={slug}
          activePath={activePath}
          indent={indent}
        />
      ))}
    </>
  );
}
