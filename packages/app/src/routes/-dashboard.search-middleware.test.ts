import { retainSearchParams, stripSearchParams } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";

type DashboardSearch = {
  from?: string;
  to?: string;
  refresh?: string;
  page?: number;
};

type DashboardSearchMiddleware = (ctx: {
  search: DashboardSearch;
  next: (newSearch: DashboardSearch) => DashboardSearch;
}) => DashboardSearch;

const strip = stripSearchParams({
  from: DEFAULT_TIME_RANGE.from,
  to: DEFAULT_TIME_RANGE.to,
  refresh: "",
}) as DashboardSearchMiddleware;
const retain = retainSearchParams<DashboardSearch>([
  "from",
  "to",
  "refresh",
]) as DashboardSearchMiddleware;

const middlewares: Array<DashboardSearchMiddleware> = [strip, retain];

function applyMiddlewares(
  current: DashboardSearch,
  destination: DashboardSearch,
): DashboardSearch {
  const applyAt = (index: number, search: DashboardSearch): DashboardSearch => {
    const middleware = middlewares[index];
    if (!middleware) {
      return destination;
    }
    return middleware({
      search,
      next: (nextSearch) => applyAt(index + 1, nextSearch),
    });
  };

  return applyAt(0, current);
}

describe("dashboard search middlewares", () => {
  it("does not restore old range when destination explicitly selects defaults", () => {
    const result = applyMiddlewares(
      { from: "now-24h", to: "now", refresh: "10s" },
      { from: "now-7d", to: "now", refresh: "10s" },
    );

    expect(result).toEqual({ refresh: "1000" });
  });

  it("retains current range when destination omits time params", () => {
    const result = applyMiddlewares(
      { from: "now-24h", to: "now-1h", refresh: "10s" },
      { page: 2 },
    );

    expect(result).toEqual({
      from: "now-24h",
      to: "now-1h",
      refresh: "10s",
      page: 2,
    });
  });
});
