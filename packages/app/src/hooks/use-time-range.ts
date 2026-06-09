import type { TimeRange } from "@everr/ui/lib/time-range";
import { useMatches, useNavigate, useSearch } from "@tanstack/react-router";
import {
  applyRouteTimeDefaults,
  ResolvedTimeRangeSearchSchema,
  type RouteTimeDefaults,
} from "@/lib/time-range";

const EMPTY_TIME_DEFAULTS: RouteTimeDefaults = {};

/**
 * Time defaults declared by the deepest active route via its loader data
 * (`{ timeDefaults }`). Routes that declare nothing fall through to the global
 * default, so this is a no-op everywhere except routes that opt in.
 */
export function useRouteTimeDefaults(): RouteTimeDefaults {
  return useMatches({
    select: (matches) => {
      for (let i = matches.length - 1; i >= 0; i--) {
        const data = matches[i]?.loaderData as
          | { timeDefaults?: RouteTimeDefaults }
          | undefined;
        if (data?.timeDefaults) return data.timeDefaults;
      }
      return EMPTY_TIME_DEFAULTS;
    },
  });
}

export function useTimeRange() {
  const search = useSearch({ from: "/_authenticated/_dashboard" });
  const defaults = useRouteTimeDefaults();
  const { from, to } = ResolvedTimeRangeSearchSchema.parse(
    applyRouteTimeDefaults(search, defaults),
  );
  const navigate = useNavigate();

  const setTimeRange = (range: TimeRange) => {
    void navigate({
      // @ts-expect-error -- route-agnostic navigation; useNavigate() can't infer search params without route context
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        from: range.from,
        to: range.to,
      }),
    });
  };

  return { timeRange: { from, to }, setTimeRange };
}
