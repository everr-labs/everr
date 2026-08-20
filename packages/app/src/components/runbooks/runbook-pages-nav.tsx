import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";
import type { PageNavNode } from "@/data/runbooks/pages";

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
 * the empty margin left of the reading column, contributing no width, so the
 * runbook stays centered in its pane. Where the pane is too narrow for that
 * margin (`@[66rem]` is the column plus a nav on either side), the same links
 * lie down into a scrolling strip above the runbook instead.
 */
export function RunbookPagesNav(props: PagesNavProps) {
  return (
    <>
      <nav
        aria-label="Runbook pages"
        className="-mx-1 mb-5 flex items-center gap-0.5 overflow-x-auto pb-1 @[66rem]/pane:hidden"
      >
        <PageLinks {...props} inline />
      </nav>
      {/*
        `inset-y-0 right-full` pins this outside the reading column, so it
        takes none of the column's width and the runbook stays centered. The
        list sticks inside that full-height box as the pane scrolls.
      */}
      <div className="absolute inset-y-0 right-full hidden pr-5 @[66rem]/pane:block">
        <nav
          aria-label="Runbook pages"
          className="sticky top-3 flex w-40 flex-col gap-0.5"
        >
          <PageLinks {...props} />
        </nav>
      </div>
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
 * knows it exactly. Floating, the link carries no surface of its own, so the
 * current page is marked by weight and contrast rather than a filled row.
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
      style={
        inline
          ? undefined
          : ({ paddingLeft: `${depth * PAGE_STEP + 8}px` } as CSSProperties)
      }
      className={cn(
        "truncate rounded-md py-1 text-muted-foreground text-sm transition-colors hover:text-foreground",
        inline ? "shrink-0 px-2 hover:bg-muted/50" : "block pr-2",
        active && "font-medium text-foreground",
        active && inline && "bg-muted",
      )}
      aria-current={active ? "page" : undefined}
      // Floating, the nav is too narrow for long page names to fit.
      title={typeof children === "string" ? children : undefined}
    >
      {children}
    </Link>
  );
}
