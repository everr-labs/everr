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

export function NotebookMarkdown({ markdown }: { markdown: string }) {
  // The app runs dark-only (see styles/global.css — :root is the dark theme),
  // so prose-invert is applied unconditionally for readable text.
  return (
    <div className="prose prose-invert max-w-none">
      <Markdown remarkPlugins={[remarkGfm]} components={{ pre: PreBlock }}>
        {markdown}
      </Markdown>
    </div>
  );
}
