import {
  DetailRouteDialog,
  ErrorDetail,
  type ErrorIssueSearch,
  ErrorIssueSearchSchema,
  ErrorIssues,
  type ErrorOccurrence,
  ErrorTracePanel,
  getErrorOccurrenceKey,
} from "@everr/telemetry-explorer/errors";
import { buttonVariants } from "@everr/ui/components/button";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useRouteParam, useRouteSearch, useSearchPatch } from "../../shell/search-io";
import { useExploreBackend } from "../backend";
import { errorsRoute } from "../routes";
import { ExplorePersistentFilters } from "./persistent-filters";

export function ErrorsRoute() {
  // Always keep the list mounted in the same position so opening/closing the
  // modal never remounts it (a remount resets the virtualized list and re-runs
  // queries, which shows up as a flash on close).
  return (
    <>
      <ErrorsPage />
      <Outlet />
    </>
  );
}

function ErrorsPage() {
  const { repos } = useExploreBackend();
  const search = useRouteSearch(errorsRoute.validateSearch);
  const patchSearch = useSearchPatch();
  const { service = [], environment = [] } = search;
  const { timeRange, q, fingerprint, sort, attributes } = withTimeRange(search);

  return (
    <ErrorIssues
      repo={repos.errors}
      timeRange={timeRange}
      search={{ q, service, fingerprint, sort, attributes }}
      environment={environment}
      persistentFilters={<ExplorePersistentFilters />}
      onSearchChange={(patch) =>
        // Push a history entry per change so Back undoes filter changes one at a
        // time (including Clear page filters, which routes through this same
        // handler).
        patchSearch(patch)
      }
      renderIssueLink={({ fingerprint: issueFingerprint, className, children }) => (
        <Link
          to="/errors/$fingerprint/modal"
          params={{ fingerprint: issueFingerprint }}
          search={{ ...search, occurrence: "" }}
          className={className}
        >
          {children}
        </Link>
      )}
    />
  );
}

export function ErrorModalRoute() {
  const fingerprint = useRouteParam("fingerprint");
  const search = useRouteSearch(ErrorIssueSearchSchema);
  const navigate = useNavigate();
  const close = () =>
    navigate({
      to: "/errors",
      search: { ...search, occurrence: "" },
    });

  return (
    <DetailRouteDialog title="Error detail" onClose={close}>
      <ErrorDetailRouteContent
        fingerprint={fingerprint}
        search={search}
        detailTo="/errors/$fingerprint/modal"
        onClose={() => void close()}
      />
    </DetailRouteDialog>
  );
}

export function ErrorPageRoute() {
  const fingerprint = useRouteParam("fingerprint");
  const search = useRouteSearch(ErrorIssueSearchSchema);
  const navigate = useNavigate();

  return (
    <ErrorDetailRouteContent
      fingerprint={fingerprint}
      search={search}
      detailTo="/errors/$fingerprint"
      onBack={() =>
        void navigate({
          to: "/errors",
          search: { ...search, occurrence: "" },
        })
      }
    />
  );
}

function ErrorDetailRouteContent({
  fingerprint,
  search,
  detailTo,
  onBack,
  onClose,
}: {
  fingerprint: string;
  search: ErrorIssueSearch;
  detailTo: "/errors/$fingerprint" | "/errors/$fingerprint/modal";
  onBack?: () => void;
  onClose?: () => void;
}) {
  const { repos } = useExploreBackend();
  const { timeRange, service } = withTimeRange(search);

  return (
    <ErrorDetail
      repo={repos.errors}
      fingerprint={fingerprint}
      timeRange={timeRange}
      service={service}
      occurrence={search.occurrence}
      onBack={onBack}
      onClose={onClose}
      renderOccurrenceLink={({ occurrence: linkedOccurrence, label, className, children }) => (
        <Link
          to={detailTo}
          params={{ fingerprint }}
          search={{
            ...search,
            occurrence: getErrorOccurrenceKey(linkedOccurrence),
          }}
          // A step of the pager replaces the history entry, so that Back
          // leaves the Error and does not go through each occurrence again.
          replace
          aria-label={label}
          title={label}
          className={className}
        >
          {children}
        </Link>
      )}
      renderTracePanel={({ occurrence }) => <ExploreErrorTracePanel occurrence={occurrence} />}
    />
  );
}

function ExploreErrorTracePanel({ occurrence }: { occurrence: ErrorOccurrence }) {
  const { useErrorTraceSpans } = useExploreBackend();
  const hasTrace = occurrence.traceId.length > 0;
  const traceSpans = useErrorTraceSpans(occurrence.traceId, hasTrace);

  return (
    <ErrorTracePanel
      occurrence={occurrence}
      spans={traceSpans.spans}
      isPending={traceSpans.isPending && hasTrace}
      isError={traceSpans.isError}
      isStale={traceSpans.isStale}
      onRetry={traceSpans.refetch}
      renderTraceLink={({ traceId, spanId, children }) => (
        <Link
          to="/traces/$traceId"
          params={{ traceId }}
          search={{ span: spanId || undefined }}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {children}
        </Link>
      )}
    />
  );
}
