// Marketing attribution stamped from the landing query string only: the five
// standard UTM params as `everr.utm.*`, an allowlist so attribute keys stay
// bounded. Nothing is stamped when absent, so organic traffic carries zero
// extra attributes. Ad-platform click ids (gclid and friends) are
// deliberately not captured for now.

export function attributionAttributes(
  landingSearch: string,
): Record<string, string> {
  const params = new URLSearchParams(landingSearch);
  const attributes: Record<string, string> = {};
  for (const name of ["source", "medium", "campaign", "term", "content"]) {
    const value = params.get(`utm_${name}`);
    if (value) attributes[`everr.utm.${name}`] = value;
  }
  return attributes;
}
