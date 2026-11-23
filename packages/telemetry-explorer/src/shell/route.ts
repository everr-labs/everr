import "../static-data";
import { parse, resolve } from "@everr/datemath";
import { ExploreSearchShape } from "../filters";
import { ResolvedTimeRangeSearchSchema, TimeRangeSearchSchema } from "@everr/ui/lib/time-range";
import { redirect } from "@tanstack/react-router";
import { retain, stripDefaults } from "./search-middleware";

/**
 * The search the shell layout route validates. An app that needs more keys on
 * that route extends this schema and passes the result as `validateSearch`
 * after spreading `shellRouteOptions`.
 */
export const ShellSearchSchema = TimeRangeSearchSchema.extend({
  // Explore section filters live at this level (not deeper on `_explore`) so the
  // sidebar links, rendered in this layout, retain them on click. See the
  // retain note below.
  ...ExploreSearchShape,
});

/** A bound that names a date rather than a time relative to now. */
function isFixed(expr: string): boolean {
  try {
    return parse(expr).anchor !== "now";
  } catch {
    return false;
  }
}

/**
 * Options for the layout route that renders `AppShell`. `retain` names the
 * app's own search keys that follow the user across navigation, next to the
 * shell's.
 */
export function shellRouteOptions(options: { retain?: readonly string[] } = {}) {
  return {
    validateSearch: ShellSearchSchema,
    search: {
      // `service`/`environment` are retained HERE (not on `_explore`) on purpose:
      // the sidebar links live in this layout, outside the `_explore` subtree, so
      // only a retain declared at this level engages on a sidebar click.
      // Declaring it on `_explore` makes the link's href look right but drops
      // the params on the actual click. The explore route schemas include these
      // keys so the destination route doesn't strip them on arrival.
      //
      // strip-then-retain, paired with optional (default-less) explore schemas, is
      // what makes the filters both persistent AND clearable:
      //   - cross-route nav: the key arrives absent (no schema default fills it),
      //     so retain copies the live selection forward;
      //   - explicit clear (service: []): the value is present, so strip drops it
      //     as a default and retain, which only refills ABSENT keys, leaves it
      //     gone, yielding a clean URL that reflects the cleared state.
      // See ExploreSearchShape for why the schemas must stay optional.
      middlewares: [
        stripDefaults({ service: [], environment: [] }),
        retain(["from", "to", "refresh", "service", "environment", ...(options.retain ?? [])]),
      ],
    },
    beforeLoad({ search }: { search: { from?: string; to?: string; refresh?: string } }) {
      const { from, to } = ResolvedTimeRangeSearchSchema.parse(search);
      // Two dates in the wrong order are a typo, so they swap. A relative range
      // that ends before it starts only does at some times of day ("now/d" to
      // "now-5h" before 05:00), and in the viewer's zone, not the server's: it
      // stays, and the pages show nothing while the time picker says why.
      if (!isFixed(from) || !isFixed(to)) return;
      const fromDate = resolve(from, { roundUp: false });
      const toDate = resolve(to, { roundUp: true });
      if (fromDate > toDate) {
        throw redirect({
          search: { ...search, from: to, to: from },
          replace: true,
        });
      }
    },
  };
}
