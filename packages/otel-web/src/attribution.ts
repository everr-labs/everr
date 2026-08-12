// The marketing attribution. The code reads it only from the query string of
// the landing page. It writes the five standard UTM parameters as
// `everr.utm.*`. This is a list of permitted names, and thus the number of
// attribute keys is limited. When a parameter is absent, the code writes
// nothing. Thus organic traffic carries no additional attribute. The code does
// not capture the click ids of the advertisement platforms, for example gclid.
// This is correct for now.

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
