import { Spinner } from "@everr/ui/components/spinner";
import { ClientOnly, useRouterState } from "@tanstack/react-router";

/**
 * What the window shows while the router loads the next page. The router keeps
 * the current page on screen until the next one is ready, so a navigation gets
 * a thin bar along the top: it waits 300ms before appearing, so a quick one
 * shows nothing, and creeps towards 80% rather than claiming progress it cannot
 * measure.
 *
 * The first load has no page to keep. A server-rendered one arrives already
 * resolved; one the client renders itself (the dev shell) gets a full-window
 * spinner until it resolves, and the bar stays at rest until then, so it
 * always starts from zero and its delay applies.
 */
export function NavigationProgress() {
  const firstLoad = useRouterState({ select: (state) => !state.resolvedLocation });
  const pending = useRouterState({ select: (state) => state.status === "pending" });
  // The bar keeps the same markup through the first load, so a server-rendered
  // page hydrates against exactly what the server sent.
  const showBar = pending && !firstLoad;
  return (
    <>
      <ClientOnly>
        {firstLoad && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background">
            <Spinner className="size-5 text-primary" />
          </div>
        )}
      </ClientOnly>
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5">
        <div
          className="h-full bg-primary"
          style={
            showBar
              ? {
                  width: "80%",
                  opacity: 1,
                  transition: "width 8s cubic-bezier(0.1, 0.6, 0.3, 1) 300ms, opacity 0ms 300ms",
                }
              : { width: 0, opacity: 0, transition: "none" }
          }
        />
      </div>
    </>
  );
}
