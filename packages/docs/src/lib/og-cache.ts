// Share images only change with a deploy: let crawlers and CDNs keep them for a day
// instead of rendering a PNG on every fetch
export function cacheShareImage(response: Response) {
  response.headers.set("cache-control", "public, max-age=86400");
  return response;
}

// HEAD gets the headers without rendering: a HEAD answered from GET cancels the
// image stream while takumi still writes to it, which throws on the server
export function shareImageHead() {
  return cacheShareImage(new Response(null, { headers: { "content-type": "image/png" } }));
}
