import { ScrollArea } from "@everr/ui/components/scroll-area";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import {
  Children,
  type ComponentPropsWithoutRef,
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { hrefHash } from "#app/data/runbooks/pages.ts";
import { nodeText, RunbookCodeBlock } from "./runbook-code-block";
import { HEADING_COMPONENTS, RunbookBlockquote, RunbookImage } from "./runbook-markdown-blocks";
import {
  remarkAllowedHtml,
  remarkCallouts,
  remarkCodeMeta,
  remarkHeadingIds,
  remarkImagesInLinks,
} from "./runbook-markdown-plugins";
import { PanelEmbedBlock } from "./runbook-panel-embed";

/**
 * Fences arrive as <pre><code className="language-…">. Intercept at the <pre>
 * level so a ```panel embed replaces the whole block (a Card inside a <pre>
 * would be invalid markup); every other block renders as a code block.
 */
function PreBlock({ children }: AnchorOrBlockProps<"pre">) {
  const only = Children.toArray(children)[0];
  const {
    className,
    children: code,
    "data-meta": meta,
  } = isValidElement<{
    className?: string;
    children?: ReactNode;
    // The fence's info string after its language (see remarkCodeMeta).
    "data-meta"?: string;
  }>(only)
    ? only.props
    : {};
  const language = className
    ?.split(" ")
    .find((name) => name.startsWith("language-"))
    ?.slice("language-".length);
  if (language === "panel") return <PanelEmbedBlock source={nodeText(code)} />;
  return <RunbookCodeBlock language={language} meta={meta} code={nodeText(code)} />;
}

/**
 * react-markdown passes a `node` (the hast element) to custom components; it
 * must never reach the DOM or it logs an "unknown prop" warning. This type adds
 * it so we can destructure it out before spreading the rest.
 */
type AnchorOrBlockProps<T extends "a" | "pre"> = ComponentPropsWithoutRef<T> & {
  node?: unknown;
};

interface RunbookLinkContextValue {
  /** Resolve an href to a runbook page path ("" = index); null → plain anchor. */
  resolveLink?: (href: string) => string | null;
  project?: string;
  slug?: string;
}

const RunbookLinkContext = createContext<RunbookLinkContextValue>({});

/** True for hrefs that leave the app (scheme like http:/mailto:, or //host). */
function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

/**
 * Anchor renderer for runbook markdown. Defined at module scope (not inside
 * RunbookMarkdown) and reading its inputs from context, so react-markdown sees
 * one stable component type and never unmounts/remounts the links on re-render.
 * In-runbook links become router <Link>s; external/unresolved ones stay plain
 * anchors, with external targets opened safely in a new tab.
 */
function RunbookAnchor({ node: _node, href, children, ...props }: AnchorOrBlockProps<"a">) {
  const { resolveLink, project, slug } = useContext(RunbookLinkContext);

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
          {children}
        </Link>
      ) : (
        <Link
          to="/runbooks/$project/$slug/$"
          params={{ project, slug, _splat: resolved }}
          hash={hash}
          {...props}
        >
          {children}
        </Link>
      );
    }
  }

  // External links open in a new tab (rel guards against tab-nabbing) so a click
  // doesn't navigate the whole app away; hash/app-relative links stay in place.
  const external = typeof href === "string" && isExternalHref(href);
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
      {children}
      {external && /^(https?:)?\/\//i.test(href) && !onlyImage && (
        <ArrowUpRight aria-label="(opens in a new tab)" className="runbook-external-icon" />
      )}
    </a>
  );
}

/** A wide table scrolls on its own rather than squeezing its columns. */
function ScrollingTable({
  node: _node,
  ...props
}: ComponentPropsWithoutRef<"table"> & { node?: unknown }) {
  return (
    <ScrollArea className="runbook-table" orientation="horizontal">
      <table {...props} />
    </ScrollArea>
  );
}

// Stable references: react-markdown re-parses/re-renders when these change
// identity, so they live at module scope rather than inline.
const MARKDOWN_COMPONENTS: Components = {
  ...HEADING_COMPONENTS,
  pre: PreBlock,
  a: RunbookAnchor,
  table: ScrollingTable,
  blockquote: RunbookBlockquote,
  img: RunbookImage,
};
const REMARK_PLUGINS = [
  remarkGfm,
  remarkAllowedHtml,
  remarkCallouts,
  remarkHeadingIds,
  remarkCodeMeta,
  remarkImagesInLinks,
];

interface RunbookMarkdownProps {
  markdown: string;
  /** Resolve an href to a runbook page path ("" = index); null → plain anchor. */
  resolveLink?: (href: string) => string | null;
  /** Required (with slug) to render in-runbook links as router <Link>s. */
  project?: string;
  slug?: string;
  /** The rendered prose, for the table of contents to read its headings from. */
}

export function RunbookMarkdown({ markdown, resolveLink, project, slug }: RunbookMarkdownProps) {
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
}
