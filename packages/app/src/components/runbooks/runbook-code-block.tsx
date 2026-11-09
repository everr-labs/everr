import { Button } from "@everr/ui/components/button";
import { useCopyToClipboard } from "@everr/ui/hooks/use-copy-to-clipboard";
import { cn } from "@everr/ui/lib/utils";
import { Check, Copy, WrapText } from "lucide-react";
import {
  Children,
  isValidElement,
  type ReactNode,
  Suspense,
  useMemo,
  useRef,
  useState,
} from "react";
import { HighlightedCode, LanguageName } from "./highlighted-code";

/** The text a code element renders, highlighted spans and all. */
export function nodeText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement<{ children?: ReactNode }>(child)) return nodeText(child.props.children);
      return "";
    })
    .join("");
}

/** The options a fence's info string carries after its language. */
function parseFenceMeta(meta: string | undefined): {
  title: string | undefined;
  marked: Set<number>;
} {
  const title = meta?.match(/title=(?:"([^"]*)"|'([^']*)'|(\S+))/);
  const marked = new Set<number>();
  const ranges = meta?.match(/\{([\d\s,-]+)\}/)?.[1] ?? "";
  for (const range of ranges.split(",")) {
    const [from, to = from] = range.split("-").map((part) => Number.parseInt(part, 10));
    if (from === undefined || !Number.isFinite(from) || !Number.isFinite(to)) continue;
    for (let line = from; line <= Math.min(to, from + 1000); line++) marked.add(line);
  }
  return { title: title?.[1] ?? title?.[2] ?? title?.[3], marked };
}

const SHELLS = new Set(["bash", "sh", "shell", "zsh", "console", "shell-session"]);

/**
 * What copying a block puts on the clipboard. A shell session, with
 * commands after a `$ ` prompt, copies the commands alone, so they paste
 * straight into a terminal.
 */
function copyableText(language: string | undefined, code: string): string {
  if (!language || !SHELLS.has(language.toLowerCase())) return code;
  const lines = code.split("\n");
  const commands = lines.filter((line) => line.startsWith("$ "));
  return commands.length > 0 ? commands.map((line) => line.slice(2)).join("\n") : code;
}

/**
 * A fenced code block: its title or language above it, with buttons to wrap
 * long lines and to copy it. `language` is the fence's language, `meta` the
 * rest of its info string (`title="…"`, lines to mark as `{2,4-6}`).
 */
export function RunbookCodeBlock({
  language,
  meta,
  code,
}: {
  language: string | undefined;
  meta: string | undefined;
  code: string;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const [wrap, setWrap] = useState(false);
  // Fences end with a newline that isn't part of the code.
  const text = code.replace(/\n$/, "");
  const { title, marked } = useMemo(() => parseFenceMeta(meta), [meta]);
  const { state, copy } = useCopyToClipboard(copyableText(language, text), {
    selectOnFailure: preRef,
  });
  const copied = state === "copied";

  return (
    <figure className="runbook-code-block group">
      <figcaption className="flex h-9 items-center justify-between gap-2 border-b border-border pr-1.5 pl-4 text-xs text-muted-foreground">
        <span className={cn("truncate font-medium", title && "text-foreground")}>
          {title ? (
            title
          ) : language ? (
            // As written until a grammar outside the common set has loaded.
            <Suspense fallback={language}>
              <LanguageName language={language} />
            </Suspense>
          ) : (
            "Text"
          )}
        </span>
        <span className="flex items-center gap-1.5">
          <output
            className={cn(
              "transition-all duration-200",
              copied || state === "failed"
                ? "translate-x-0 opacity-100"
                : "translate-x-1 opacity-0",
            )}
          >
            {/* Kept while fading out, so the label doesn't vanish before it does. */}
            {state === "failed" ? "Clipboard blocked: code selected" : "Copied"}
          </output>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Wrap long lines"
            aria-pressed={wrap}
            onClick={() => setWrap(!wrap)}
            className={cn(
              "text-muted-foreground group-hover:text-foreground",
              wrap && "bg-muted text-foreground",
            )}
          >
            <WrapText />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={copied ? "Copied" : "Copy code"}
            onClick={copy}
            className="relative text-muted-foreground group-hover:text-foreground"
          >
            <Copy
              className={cn(
                "absolute transition-all duration-200",
                copied ? "scale-50 rotate-[-30deg] opacity-0" : "scale-100 rotate-0 opacity-100",
              )}
            />
            <Check
              className={cn(
                "absolute text-primary transition-all duration-200",
                copied ? "scale-100 rotate-0 opacity-100" : "scale-50 rotate-30 opacity-0",
              )}
            />
          </Button>
        </span>
      </figcaption>
      <pre ref={preRef} data-wrap={wrap || undefined}>
        {/* Plain until a grammar outside the common set has loaded. */}
        <Suspense fallback={<code>{text}</code>}>
          <HighlightedCode language={language} code={text} marked={marked} />
        </Suspense>
      </pre>
    </figure>
  );
}
