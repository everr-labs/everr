import { Link } from "@tanstack/react-router";
import {
  Children,
  type ComponentPropsWithoutRef,
  isValidElement,
  type ReactNode,
} from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
function PreBlock({ children, ...props }: ComponentPropsWithoutRef<"pre">) {
  const only = Children.toArray(children)[0];
  if (isValidElement<{ className?: string; children?: ReactNode }>(only)) {
    const { className, children: code } = only.props;
    if (className?.split(" ").includes("language-panel")) {
      return <PanelEmbedBlock source={codeText(code)} />;
    }
  }
  return <pre {...props}>{children}</pre>;
}

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
  // Render in-notebook links as TanStack Router <Link>s; everything else
  // (external/unresolved) falls through to a plain anchor.
  function Anchor({ href, children, ...props }: ComponentPropsWithoutRef<"a">) {
    if (
      resolveLink &&
      project !== undefined &&
      slug !== undefined &&
      typeof href === "string"
    ) {
      const resolved = resolveLink(href);
      if (resolved !== null) {
        return resolved === "" ? (
          <Link to="/notebooks/$project/$slug" params={{ project, slug }}>
            {children}
          </Link>
        ) : (
          <Link
            to="/notebooks/$project/$slug/$"
            params={{ project, slug, _splat: resolved }}
          >
            {children}
          </Link>
        );
      }
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }

  // The app runs dark-only (see styles/global.css — :root is the dark theme),
  // so prose-invert is applied unconditionally for readable text.
  return (
    <div className="prose prose-invert max-w-none">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{ pre: PreBlock, a: Anchor }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
