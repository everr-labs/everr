import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import type { PageNavNode } from "@/data/runbooks/pages";

interface RunbookPageNavProps {
  project: string;
  slug: string;
  indexTitle: string;
  tree: PageNavNode[];
  /** "" = index page. */
  activePath: string;
}

export function RunbookPageNav({
  project,
  slug,
  indexTitle,
  tree,
  activePath,
}: RunbookPageNavProps) {
  return (
    <nav className="w-56 shrink-0" aria-label="Runbook pages">
      <ul className="flex flex-col gap-0.5 text-sm">
        <li>
          <Link
            to="/runbooks/$project/$slug"
            params={{ project, slug }}
            className={cn(
              "block rounded-md px-2 py-1 hover:bg-accent/50",
              activePath === "" && "bg-accent font-medium",
            )}
          >
            {indexTitle}
          </Link>
        </li>
        {tree.map((node) => (
          <PageNavRow
            key={node.path}
            node={node}
            depth={0}
            project={project}
            slug={slug}
            activePath={activePath}
          />
        ))}
      </ul>
    </nav>
  );
}

function PageNavRow({
  node,
  depth,
  project,
  slug,
  activePath,
}: {
  node: PageNavNode;
  depth: number;
  project: string;
  slug: string;
  activePath: string;
}) {
  return (
    <li>
      <Link
        to="/runbooks/$project/$slug/$"
        params={{ project, slug, _splat: node.path }}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        className={cn(
          "block rounded-md px-2 py-1 hover:bg-accent/50",
          activePath === node.path && "bg-accent font-medium",
        )}
      >
        {node.title}
      </Link>
      {node.children.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {node.children.map((child) => (
            <PageNavRow
              key={child.path}
              node={child}
              depth={depth + 1}
              project={project}
              slug={slug}
              activePath={activePath}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
