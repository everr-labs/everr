import { Suspense, use, useSyncExternalStore } from "react";

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
  if (!isClient) return <Placeholder />;

  return (
    <Suspense fallback={<Placeholder />}>
      <Diagram chart={chart} />
    </Suspense>
  );
}

function Placeholder() {
  return <div className="my-8 min-h-48" aria-hidden />;
}

function Diagram({ chart }: { chart: string }) {
  const svg = use(renderChart(chart));
  return (
    <div
      className="my-8 overflow-x-auto [&_svg]:h-auto [&_svg]:min-w-[48rem]"
      // oxlint-disable-next-line react/no-danger -- Mermaid sanitizes its SVG at securityLevel "strict".
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
