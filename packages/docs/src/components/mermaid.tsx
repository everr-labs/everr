import { Suspense, use, useSyncExternalStore } from "react";
import { mermaidTitle } from "@/lib/mermaid-title";

// One diagram per chart text, rendered once. The mermaid module loads on first use,
// so it stays out of the entry chunk and out of pages without a diagram.
const loadMermaid = lazyOnce(async () => {
  const { default: mermaid } = await import("mermaid");
  // The site is dark only
  mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
  return mermaid;
});

const renders = new Map<string, Promise<string>>();

function renderChart(chart: string) {
  let svg = renders.get(chart);
  if (!svg) {
    svg = loadMermaid().then(async (mermaid) => {
      const result = await mermaid.render(`mermaid-${renders.size}`, chart);
      return result.svg;
    });
    renders.set(chart, svg);
  }
  return svg;
}

function lazyOnce<T>(load: () => Promise<T>) {
  let promise: Promise<T> | undefined;
  return () => (promise ??= load());
}

const subscribe = () => () => {};

export function Mermaid({ chart }: { chart: string }) {
  // The server and the first client render show the same empty block
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const title = mermaidTitle(chart);
  if (!isClient) return <Placeholder title={title} />;

  return (
    <Suspense fallback={<Placeholder title={title} />}>
      <Diagram chart={chart} title={title} />
    </Suspense>
  );
}

// The title is the accessible name from the first server render, before the SVG exists
function Placeholder({ title }: { title?: string }) {
  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- A div labels the diagram, whose SVG is inlined markup.
  return <div className="my-8 min-h-48" role="img" aria-label={title} />;
}

function Diagram({ chart, title }: { chart: string; title?: string }) {
  const svg = use(renderChart(chart));
  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- A div labels the diagram, whose SVG is inlined markup.
      role="img"
      aria-label={title}
      className="my-8 overflow-x-auto [&_svg]:h-auto [&_svg]:min-w-[48rem]"
      // oxlint-disable-next-line react/no-danger -- Mermaid sanitizes its SVG at securityLevel "strict".
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
