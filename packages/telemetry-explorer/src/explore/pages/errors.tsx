import {
  ErrorDetail,
  ErrorIssueSearchSchema,
  ErrorIssues,
  type ErrorOccurrence,
  ErrorTracePanel,
  getErrorOccurrenceKey,
} from "../../errors";
import { buttonVariants } from "@everr/ui/components/button";
import { withTimeRange } from "@everr/ui/lib/time-range";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useRouteParam, useRouteSearch, useSearchPatch } from "../../shell/search-io";
import { useLastOpened } from "../../shell/use-last-opened";
import { useExploreBackend } from "../backend";
import { errorsRoute } from "../routes";
import { DetailOverList } from "./detail-over-list";
import { ExplorePersistentFilters } from "./persistent-filters";

export function ErrorsRoute() {
  const { repos } = useExploreBackend();
  const search = useRouteSearch(errorsRoute.validateSearch);
  const patchSearch = useSearchPatch();
  const { service = [], environment = [] } = search;
  const { timeRange, q, fingerprint, sort, attributes } = withTimeRange(search);
  const lastOpenedFingerprint = useLastOpened(useParams({ strict: false }).fingerprint);

  return (
    <DetailOverList
      list={
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
          lastOpenedFingerprint={lastOpenedFingerprint}
          renderIssueLink={({ fingerprint: issueFingerprint, className, children }) => (
            <Link
              to="/errors/$fingerprint"
              params={{ fingerprint: issueFingerprint }}
              search={{ ...search, occurrence: "" }}
              className={className}
            >
              {children}
            </Link>
          )}
        />
      }
    />
  );
}

export function ErrorPageRoute() {
  const { repos } = useExploreBackend();
  const fingerprint = useRouteParam("fingerprint");
  const search = useRouteSearch(ErrorIssueSearchSchema);
  const navigate = useNavigate();
  const { timeRange, service } = withTimeRange(search);

  return (
    <ErrorDetail
      repo={repos.errors}
      fingerprint={fingerprint}
      timeRange={timeRange}
      service={service}
      occurrence={search.occurrence}
      onBack={() =>
        void navigate({
          to: "/errors",
          search: { ...search, occurrence: "" },
        })
      }
      renderOccurrenceLink={({ occurrence: linkedOccurrence, label, className, children }) => (
        <Link
          to="/errors/$fingerprint"
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
