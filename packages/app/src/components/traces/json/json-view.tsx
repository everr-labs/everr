import type { Span } from "@/data/traces/types";

type Props = { spans: Span[] };

export function JsonView({ spans }: Props) {
  return (
    <pre className="bg-muted/30 flex-1 overflow-auto p-4 font-mono text-xs">
      {JSON.stringify(spans, null, 2)}
    </pre>
  );
}
