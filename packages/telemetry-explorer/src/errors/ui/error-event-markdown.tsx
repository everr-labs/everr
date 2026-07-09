import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

// The app runs dark-only, so prose-invert is unconditional (same convention
// as the runbook renderer in @everr/app).
export function ErrorEventMarkdown({ children }: { children: string }) {
  return (
    // Headings are capped near the body size: an Investigation's h2 must not
    // shout over the page's own hierarchy inside a timeline entry.
    <div className="prose prose-invert prose-sm min-w-0 max-w-none break-words prose-h1:text-base prose-h2:text-sm prose-h3:text-sm prose-h4:text-xs">
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}
