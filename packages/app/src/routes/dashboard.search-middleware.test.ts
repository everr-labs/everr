import { retainSearchParams, stripSearchParams } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { DEFAULT_TIME_RANGE } from "@/lib/time-range";

const middlewares = [
  stripSearchParams({
    from: DEFAULT_TIME_RANGE.from,
    to: DEFAULT_TIME_RANGE.to,
    refresh: "",
  }),
  retainSearchParams(["from", "to", "refresh"]),
] as Array<any>;

function applyMiddlewares(
  current: Record<string, unknown>,
  destination: Record<string, unknown>,
) {
  const final = () => destination as any;
  const chain = middlewares.reduceRight(
    (next: any, middleware: any) => (search: Record<string, unknown>) =>
      middleware({ search, next }),
    final,
  );
  return chain(current);
}

describe("dashboard search middlewares", () => {
  it("does not restore old range when destination explicitly selects defaults", () => {
    const result = applyMiddlewares(
      { from: "now-24h", to: "now", refresh: "10s" },
      { from: "now-7d", to: "now", refresh: "10s" },
    );

    expect(result).toEqual({ refresh: "10s" });
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
