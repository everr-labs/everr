import { Spinner } from "@everr/ui/components/spinner";
import { ClientOnly, useRouterState } from "@tanstack/react-router";

/**
 * The router keeps the current page until the next is ready, so the bar waits
 * 300ms (a quick navigation shows nothing) and creeps towards 80%, since
 * progress cannot be measured. A client-rendered first load (the dev shell)
 * has no page to keep and gets a full-window spinner instead.
 */
export function NavigationProgress() {
  const firstLoad = useRouterState({ select: (state) => !state.resolvedLocation });
  const pending = useRouterState({ select: (state) => state.status === "pending" });
  // Same markup through the first load, so a server-rendered page hydrates.
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
