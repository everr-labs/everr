// Marketing attribution stamped from the landing URL only: UTM params as
// `everr.utm.*`. Nothing is stamped when absent, so organic traffic carries
// zero extra attributes. Ad-platform click ids (gclid and friends) are
// deliberately not captured for now.

const UTM_PARAMS = ["source", "medium", "campaign", "term", "content"] as const;

export function attributionAttributes(
  landingUrl: string,
): Record<string, string> {
  let params: URLSearchParams;
  try {
    params = new URL(landingUrl).searchParams;
  } catch {
    return {};
  }

  const attributes: Record<string, string> = {};
  for (const name of UTM_PARAMS) {
    const value = params.get(`utm_${name}`);
    if (value) attributes[`everr.utm.${name}`] = value;
  }
  return attributes;
}
