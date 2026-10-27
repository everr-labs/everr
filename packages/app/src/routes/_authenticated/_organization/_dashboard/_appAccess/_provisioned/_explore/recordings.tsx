import { withTimeRange } from "@everr/ui/lib/time-range";
import {
  createFileRoute,
  Link,
  Outlet,
  stripSearchParams,
  useSearch,
} from "@tanstack/react-router";
import { ExplorePersistentFilters } from "#app/components/explore-persistent-filters.tsx";
import { remoteRecordingsRepo } from "#app/data/recordings/remote-repo.ts";
import { useRealtimeSubscription } from "#app/hooks/use-realtime-subscription.ts";
import { RecordingList } from "./-recordings/list";
import { defaultRecordingsSearch, RecordingsSearchSchema } from "./-recordings/search";

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore/recordings",
)({
  staticData: { breadcrumb: "Recordings" },
  validateSearch: RecordingsSearchSchema,
  search: { middlewares: [stripSearchParams(defaultRecordingsSearch)] },
  head: () => ({ meta: [{ title: "Everr - Recordings" }] }),
  component: RecordingsRoute,
});

function RecordingsRoute() {
  // Keep the list mounted in the same position so opening the detail modal
  // does not remount it and reset the virtualized list.
  return (
    <>
      <RecordingsPage />
      <Outlet />
    </>
  );
}

function RecordingsPage() {
  useRealtimeSubscription({ scope: "tenant" });
  const search = Route.useSearch();
  // service and environment are owned by the Explore layout. Read them there,
  // the same way Logs, Errors, and Traces do.
  const { service = [], environment = [] } = useSearch({
    from: "/_authenticated/_organization/_dashboard/_appAccess/_provisioned/_explore",
  });
  const { timeRange, refresh } = withTimeRange(search);

  return (
    <div className="min-h-0 flex-1 overflow-hidden">
      <section className="bg-background text-foreground flex h-full min-h-0 flex-col overflow-hidden">
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <aside className="min-h-0 overflow-auto border-b p-3 lg:border-r lg:border-b-0">
            <ExplorePersistentFilters />
          </aside>
          <main className="min-h-0 min-w-0">
            <div className="flex h-full min-h-0 flex-col">
              <RecordingList
                repo={remoteRecordingsRepo}
                timeRange={timeRange}
                refresh={refresh ?? "off"}
                service={service}
                environment={environment}
                renderClipLink={({ clipId, children }) => (
                  <Link
                    to="/recordings/$clipId/modal"
                    params={{ clipId }}
                    search={search}
                    className="block text-foreground no-underline"
                  >
                    {children}
                  </Link>
                )}
              />
            </div>
          </main>
        </div>
      </section>
    </div>
  );
}
