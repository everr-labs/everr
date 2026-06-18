import { Link } from "@tanstack/react-router";
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
import { hrefHash } from "@/data/notebooks/pages";
import { PanelEmbedBlock } from "./notebook-panel-embed";

/** Flatten react-markdown code children to the raw fence text. */
function codeText(children: ReactNode): string {
  return Children.toArray(children)
    .map((c) => (typeof c === "string" ? c : ""))
    .join("");
}

/**
 * ```panel fences arrive as <pre><code className="language-panel">. Intercept
 * at the <pre> level so the embed replaces the whole block (a Card inside a
 * <pre> would be invalid markup); every other block renders as normal code.
 */
function PreBlock({
  node: _node,
  children,
  ...props
}: AnchorOrBlockProps<"pre">) {
  const only = Children.toArray(children)[0];
  if (isValidElement<{ className?: string; children?: ReactNode }>(only)) {
    const { className, children: code } = only.props;
    if (className?.split(" ").includes("language-panel")) {
      return <PanelEmbedBlock source={codeText(code)} />;
    }
  }
  return <pre {...props}>{children}</pre>;
}

/**
 * react-markdown passes a `node` (the hast element) to custom components; it
 * must never reach the DOM or it logs an "unknown prop" warning. This type adds
 * it so we can destructure it out before spreading the rest.
 */
type AnchorOrBlockProps<T extends "a" | "pre"> = ComponentPropsWithoutRef<T> & {
  node?: unknown;
};

interface NotebookLinkContextValue {
  /** Resolve an href to a notebook page path ("" = index); null → plain anchor. */
  resolveLink?: (href: string) => string | null;
  project?: string;
  slug?: string;
}

const NotebookLinkContext = createContext<NotebookLinkContextValue>({});

/** True for hrefs that leave the app (scheme like http:/mailto:, or //host). */
function isExternalHref(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//");
}

/**
 * Anchor renderer for notebook markdown. Defined at module scope (not inside
 * NotebookMarkdown) and reading its inputs from context, so react-markdown sees
 * one stable component type and never unmounts/remounts the links on re-render.
 * In-notebook links become router <Link>s; external/unresolved ones stay plain
 * anchors, with external targets opened safely in a new tab.
 */
function NotebookAnchor({
  node: _node,
  href,
  children,
  ...props
}: AnchorOrBlockProps<"a">) {
  const { resolveLink, project, slug } = useContext(NotebookLinkContext);

  if (
    resolveLink &&
    project !== undefined &&
    slug !== undefined &&
    typeof href === "string"
  ) {
    const resolved = resolveLink(href);
    if (resolved !== null) {
      // Re-attach the link's "#fragment" the resolver stripped, so a link like
      // `traffic.md#errors` scrolls to the heading instead of the page top.
      const hash = hrefHash(href);
      // Spread {...props} (e.g. a markdown link's `title`) onto the Link too, so
      // those attributes aren't lost on internal links the way they'd survive on
      // external ones.
      return resolved === "" ? (
        <Link
          to="/notebooks/$project/$slug"
          params={{ project, slug }}
          hash={hash}
          {...props}
        >
          {children}
        </Link>
      ) : (
        <Link
          to="/notebooks/$project/$slug/$"
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
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      {...props}
    >
      {children}
    </a>
  );
}

// Stable references: react-markdown re-parses/re-renders when these change
// identity, so they live at module scope rather than inline.
const MARKDOWN_COMPONENTS: Components = { pre: PreBlock, a: NotebookAnchor };
const REMARK_PLUGINS = [remarkGfm];

interface NotebookMarkdownProps {
  markdown: string;
  /** Resolve an href to a notebook page path ("" = index); null → plain anchor. */
  resolveLink?: (href: string) => string | null;
  /** Required (with slug) to render in-notebook links as router <Link>s. */
  project?: string;
  slug?: string;
}

export function NotebookMarkdown({
  markdown,
  resolveLink,
  project,
  slug,
}: NotebookMarkdownProps) {
  const linkContext = useMemo(
    () => ({ resolveLink, project, slug }),
    [resolveLink, project, slug],
  );

  // The app runs dark-only (see styles/global.css — :root is the dark theme),
  // so prose-invert is applied unconditionally for readable text.
  return (
    <NotebookLinkContext.Provider value={linkContext}>
      <div className="prose prose-invert max-w-none">
        <Markdown
          remarkPlugins={REMARK_PLUGINS}
          components={MARKDOWN_COMPONENTS}
        >
          {markdown}
        </Markdown>
      </div>
    </NotebookLinkContext.Provider>
  );
}
