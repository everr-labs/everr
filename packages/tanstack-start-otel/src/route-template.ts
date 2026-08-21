// One route-template derivation for the server's http.route stamping and the
// browser's page resolver. The server matcher sees the full generated tree,
// API routes included; the client tree is pruned of server-only routes, so
// browser request spans take their url.template from the x-everr-route
// response header that the request middleware echoes, not from this function.

export type RouterLike = {
  matchRoutes(
    pathname: string,
  ): ReadonlyArray<{ routeId: string; fullPath: string }>;
};

export function routeTemplate(
  router: RouterLike,
  pathname: string,
): string | undefined {
  // Server function calls go over a deterministic prefix outside the tree.
  if (pathname.startsWith("/_serverFn/")) {
    return pathname.replace(/^\/_serverFn\/[^/]+/, "/_serverFn/:id");
  }
  const match = router.matchRoutes(pathname).at(-1);
  // matchRoutes falls through to the root match on unknown paths; an
  // unmatched path has no template rather than a fake one.
  if (match === undefined || match.routeId === "__root__") return undefined;
  // The route id keeps pathless segments such as /_authenticated; the public
  // path template is the match's fullPath.
  return match.fullPath;
}
