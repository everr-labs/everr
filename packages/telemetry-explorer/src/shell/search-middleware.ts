// `SearchMiddleware<T>` is invariant in T, and a shared route-options module
// cannot name T: it is the full search of the route that spreads the options
// (each app's parent routes plus the leaf). Built outside `createFileRoute`,
// `stripSearchParams` and `retainSearchParams` infer `SearchMiddleware<unknown>`
// and the spread does not type-check. A generic function fits every route.
import {
  retainSearchParams,
  type SearchMiddleware,
  stripSearchParams,
} from "@tanstack/react-router";

type Context<T> = Parameters<SearchMiddleware<T>>[0];
type LooseContext = Context<Record<string, unknown>>;
type PortableSearchMiddleware = <T>(ctx: Context<T>) => T;

export function stripDefaults(defaults: Record<string, unknown>): PortableSearchMiddleware {
  const strip = stripSearchParams<Record<string, unknown>>(defaults);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the middleware only reads and drops the keys in `defaults`, so it returns the search type it was given; the router's invariant T cannot say that.
  return <T>(ctx: Context<T>) => strip(ctx as unknown as LooseContext) as T;
}

export function retain(keys: readonly string[]): PortableSearchMiddleware {
  const keep = retainSearchParams<Record<string, unknown>>([...keys]);
  // oxlint-disable-next-line typescript/consistent-type-assertions -- the middleware only copies the listed keys forward, so it returns the search type it was given; the router's invariant T cannot say that.
  return <T>(ctx: Context<T>) => keep(ctx as unknown as LooseContext) as T;
}
