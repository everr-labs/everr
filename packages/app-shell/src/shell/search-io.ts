import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMemo } from "react";

type LooseNavigate = (options: {
  search: (prev: Record<string, unknown>) => Record<string, unknown>;
  replace?: boolean;
}) => Promise<void>;

/**
 * Merges `patch` into the search of the page that is open, whatever route it
 * is. A navigation without a destination has no route to check `search`
 * against, so it does not type-check in a program with a registered router.
 */
export function useSearchPatch(): (
  patch: Record<string, unknown>,
  options?: { replace?: boolean },
) => void {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- route-agnostic navigation: useNavigate() cannot type `search` without a destination route.
  const navigate = useNavigate() as unknown as LooseNavigate;
  return (patch, options) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: options?.replace });
}

/**
 * The search of the route this component is mounted on, typed by the schema
 * that route validates with. The route's id differs in each app, so the search
 * is read without naming it and parsed again: a schema returns its own output
 * unchanged. The result keeps its identity while the search does.
 */
export function useRouteSearch<T>(schema: { parse: (search: unknown) => T }): T {
  const search = useSearch({ strict: false });
  return useMemo(() => schema.parse(search), [schema, search]);
}

/** A path param of the route this component is mounted on. */
export function useRouteParam(name: "traceId" | "fingerprint"): string {
  const value = useParams({ strict: false, select: (params) => params[name] });
  if (value === undefined) {
    throw new Error(`This component needs a route with a $${name} path param.`);
  }
  return value;
}
