// Marketing attribution stamped from the landing URL only: UTM params as
// `everr.utm.*` and the ad-platform click ids as `everr.ad_id.*`. Nothing is
// stamped when absent, so organic traffic carries zero extra attributes.

const UTM_PARAMS = ["source", "medium", "campaign", "term", "content"] as const;

const AD_CLICK_IDS = [
  "gclid",
  "gclsrc",
  "gad_source",
  "dclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "twclid",
  "li_fat_id",
  "mc_cid",
  "igshid",
  "ttclid",
  "rdt_cid",
  "epik",
  "qclid",
  "sccid",
  "irclid",
  "_kx",
] as const;

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
  for (const id of AD_CLICK_IDS) {
    const value = params.get(id);
    if (value) attributes[`everr.ad_id.${id}`] = value;
  }
  return attributes;
}
