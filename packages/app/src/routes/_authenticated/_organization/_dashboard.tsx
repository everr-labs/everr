import { resolve } from "@everr/datemath";
import {
  createFileRoute,
  redirect,
  retainSearchParams,
  stripSearchParams,
} from "@tanstack/react-router";
import { z } from "zod";
import { DashboardLayout } from "@/components/dashboard-layout";
import { ExploreSearchRetainShape } from "@/lib/explore-search";
import {
  ResolvedTimeRangeSearchSchema,
  TimeRangeSearchSchema,
} from "@/lib/time-range";

const DashboardSearchSchema = TimeRangeSearchSchema.extend({
  // Explore section filters live at this level (not deeper on `_explore`) so the
  // sidebar links — rendered in this layout — retain them on click. See the
  // retainSearchParams note below.
  ...ExploreSearchRetainShape,
  github_install: z.string().optional(),
  reason: z.string().optional(),
  // Active preview (a preview/branch name). App-wide context: retained across
  // navigation (below) so the whole app stays in the same preview until the
  // user switches back to Live. Absent = Live. Bounded here (matching the
  // server's previewNameSchema cap) and coerced to Live on anything oversized,
  // so retainSearchParams can't carry a junk value around; control-character
  // rejection stays authoritative on the server at apply time.
  preview: z.string().max(200).optional().catch(undefined),
  // Dashboard variable values, e.g. ?vars={"env":"prod","svc":["a","b"]}.
  // Deliberately NOT retained across navigation — different dashboards have
  // different variables. Malformed values fall back to spec defaults.
  vars: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional()
    .catch(undefined),
});

export const Route = createFileRoute(
  "/_authenticated/_organization/_dashboard",
)({
  validateSearch: DashboardSearchSchema,
  search: {
    // `service`/`environment` are retained HERE (not on `_explore`) on purpose:
    // the sidebar links live in this `_dashboard` layout, outside the `_explore`
    // subtree, so only a retain declared at this level engages on a sidebar
    // click. Declaring it on `_explore` makes the link's href look right but
    // drops the params on the actual click. The explore route schemas include
    // these keys so the destination route doesn't strip them on arrival.
    //
    // strip-then-retain, paired with optional (default-less) explore schemas, is
    // what makes the filters both persistent AND clearable:
    //   - cross-route nav: the key arrives absent (no schema default fills it),
    //     so retain copies the live selection forward;
    //   - explicit clear (service: []): the value is present, so strip drops it
    //     as a default and retain — which only refills ABSENT keys — leaves it
    //     gone, yielding a clean URL that reflects the cleared state.
    // See ExploreSearchShape for why the schemas must stay optional.
    middlewares: [
      stripSearchParams({ service: [], environment: [] }),
      retainSearchParams([
        "from",
        "to",
        "refresh",
        "service",
        "environment",
        "preview",
      ]),
    ],
  },
  beforeLoad({ search }) {
    const { from, to } = ResolvedTimeRangeSearchSchema.parse(search);
    const fromDate = resolve(from, { roundUp: false });
    const toDate = resolve(to, { roundUp: true });
    if (fromDate >= toDate) {
      throw redirect({
        search: { ...search, from: to, to: from },
        replace: true,
      });
    }
  },
  component: DashboardLayout,
});
