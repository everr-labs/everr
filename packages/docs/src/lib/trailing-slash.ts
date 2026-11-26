// The router would redirect a trailing slash too, but always with a temporary 307.
// Leading slashes collapse to one: "//host" in a Location header is another site
export function trailingSlashRedirect(url: URL): Response | undefined {
  if (url.pathname.length <= 1 || !url.pathname.endsWith("/")) return undefined;
  const location = `/${url.pathname.replace(/^\/+|\/+$/g, "")}${url.search}`;
  return new Response(null, { status: 308, headers: { location } });
}
