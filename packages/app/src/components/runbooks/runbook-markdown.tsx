import { ScrollArea } from "@everr/ui/components/scroll-area";
import { cn } from "@everr/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import {
  Children,
  type ComponentPropsWithoutRef,
  createContext,
  isValidElement,
  memo,
  useContext,
  useMemo,
} from "react";
import Markdown, { type Components, type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { hrefHash } from "#app/data/runbooks/pages.ts";
import { RunbookCodeBlock } from "./runbook-code-block";
import {
  HEADING_COMPONENTS,
  InLinkContext,
  RunbookBlockquote,
  RunbookImage,
} from "./runbook-markdown-blocks";
import { remarkAllowedHtml, remarkCallouts, remarkHeadingIds } from "./runbook-markdown-plugins";
import { PanelEmbedBlock } from "./runbook-panel-embed";

/**
 * Fences arrive as <pre><code className="language-…">. Intercept at the <pre>
 * level so a ```panel embed replaces the whole block (a Card inside a <pre>
 * would be invalid markup); every other block renders as a code block.
 */
function PreBlock({ node }: ExtraProps) {
  const code = node?.children[0];
  if (code?.type !== "element") return null;
  const language = [code.properties.className ?? []]
    .flat()
    .map(String)
    .find((name) => name.startsWith("language-"))
    ?.slice("language-".length);
  const text = code.children.map((child) => (child.type === "text" ? child.value : "")).join("");
  if (language === "panel") return <PanelEmbedBlock source={text} />;
  return <RunbookCodeBlock language={language} meta={code.data?.meta ?? undefined} code={text} />;
}

interface RunbookLinkContextValue {
  /** Resolve an href to a runbook page path ("" = index); null → plain anchor. */
  resolveLink?: (href: string) => string | null;
  project?: string;
  slug?: string;
}

const RunbookLinkContext = createContext<RunbookLinkContextValue>({});

/**
 * Anchor renderer for runbook markdown. Defined at module scope (not inside
 * RunbookMarkdown) and reading its inputs from context, so react-markdown sees
 * one stable component type and never unmounts/remounts the links on re-render.
 * In-runbook links become router <Link>s; external/unresolved ones stay plain
 * anchors, with external targets opened safely in a new tab.
 */
function RunbookAnchor({
  node: _node,
  href,
  children,
  ...props
}: ComponentPropsWithoutRef<"a"> & ExtraProps) {
  const { resolveLink, project, slug } = useContext(RunbookLinkContext);
  // Images in a link follow it rather than open full size.
  const content = <InLinkContext.Provider value>{children}</InLinkContext.Provider>;

  if (resolveLink && project !== undefined && slug !== undefined && typeof href === "string") {
    const resolved = resolveLink(href);
    if (resolved !== null) {
      // Re-attach the link's "#fragment" the resolver stripped, so a link like
      // `traffic.md#errors` scrolls to the heading instead of the page top.
      const hash = hrefHash(href);
      // Spread {...props} (e.g. a markdown link's `title`) onto the Link too, so
      // those attributes aren't lost on internal links the way they'd survive on
      // external ones.
      return resolved === "" ? (
        <Link to="/runbooks/$project/$slug" params={{ project, slug }} hash={hash} {...props}>
          {content}
        </Link>
      ) : (
        <Link
          to="/runbooks/$project/$slug/$"
          params={{ project, slug, _splat: resolved }}
          hash={hash}
          {...props}
        >
          {content}
        </Link>
      );
    }
  }

  // Links to another site open in a new tab (rel guards against tab-nabbing),
  // so a click doesn't navigate the whole app away.
  const external = typeof href === "string" && /^(https?:)?\/\//i.test(href);
  // A linked image needs no arrow beside it.
  const onlyImage = Children.toArray(children).every(
    (child) => isValidElement(child) && child.type === RunbookImage,
  );
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...props}
    >
      {content}
      {external && !onlyImage && (
        <ArrowUpRight
          aria-label="(opens in a new tab)"
          className="ml-[0.1em] inline size-[0.85em] align-[-0.05em] text-muted-foreground"
        />
      )}
    </a>
  );
}

// Tables look like a table panel's grid (DataTable, bordered), in a card
// like a code block's. A wide one scrolls rather than squeezing its columns.
function ScrollingTable({ node: _node, ...props }: ComponentPropsWithoutRef<"table"> & ExtraProps) {
  return (
    <ScrollArea className="my-6 rounded-lg border border-border bg-card" orientation="horizontal">
      <table {...props} className="my-0! w-full border-separate border-spacing-0 text-sm" />
    </ScrollArea>
  );
}

// Cells keep their values on one line; a wide table scrolls instead.
const CELL =
  "border-r border-b border-border px-3 py-2 align-middle whitespace-nowrap last:border-r-0";

function TableHeader({ node: _node, ...props }: ComponentPropsWithoutRef<"th"> & ExtraProps) {
  return <th {...props} className={cn(CELL, "text-left font-medium text-muted-foreground")} />;
}

function TableCell({ node: _node, ...props }: ComponentPropsWithoutRef<"td"> & ExtraProps) {
  return <td {...props} className={CELL} />;
}

function TableBody({ node: _node, ...props }: ComponentPropsWithoutRef<"tbody"> & ExtraProps) {
  return <tbody {...props} className="[&>tr:hover]:bg-muted/50 [&>tr:last-child>td]:border-b-0" />;
}

// Stable references: react-markdown re-parses/re-renders when these change
// identity, so they live at module scope rather than inline.
const MARKDOWN_COMPONENTS: Components = {
  ...HEADING_COMPONENTS,
  pre: PreBlock,
  a: RunbookAnchor,
  table: ScrollingTable,
  th: TableHeader,
  td: TableCell,
  tbody: TableBody,
  blockquote: RunbookBlockquote,
  img: RunbookImage,
};
const REMARK_PLUGINS = [remarkGfm, remarkAllowedHtml, remarkCallouts, remarkHeadingIds];

interface RunbookMarkdownProps {
  markdown: string;
  /** Resolve an href to a runbook page path ("" = index); null → plain anchor. */
  resolveLink?: (href: string) => string | null;
  /** Required (with slug) to render in-runbook links as router <Link>s. */
  project?: string;
  slug?: string;
}

// Memoized: the page re-renders on every time range change, and parsing and
// highlighting the markdown again would redo the same work.
export const RunbookMarkdown = memo(function RunbookMarkdown({
  markdown,
  resolveLink,
  project,
  slug,
}: RunbookMarkdownProps) {
  const linkContext = useMemo(() => ({ resolveLink, project, slug }), [resolveLink, project, slug]);

  // The app runs dark-only (see styles/global.css — :root is the dark theme),
  // so prose-invert is applied unconditionally for readable text.
  return (
    <RunbookLinkContext.Provider value={linkContext}>
      <div className="runbook-prose prose prose-invert max-w-none">
        <Markdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
          {markdown}
        </Markdown>
      </div>
    </RunbookLinkContext.Provider>
  );
});
