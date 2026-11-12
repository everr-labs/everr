import { SITE_URL } from "@/constants";
import { getLocale, locales, localizeHref } from "@/paraglide/runtime";
import type { TranslatedPath } from "./translated";

const SITE_NAME = "Everr";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og.png`;

type HeadOptions = {
  path: string;
  title: string;
  // Without one, the site description from the root route stays
  description?: string;
  type?: "website" | "article";
  image?: string;
};

// Canonical URL, Open Graph and Twitter tags. Always the production address: search
// engines read these, and the server and the browser have to render the same value
export function seoHead({
  path,
  title,
  description,
  type = "website",
  image = DEFAULT_OG_IMAGE,
}: HeadOptions) {
  const url = SITE_URL + path;
  return {
    meta: [
      { title },
      ...(description
        ? [
            { name: "description", content: description },
            { property: "og:description", content: description },
            { name: "twitter:description", content: description },
          ]
        : []),
      { property: "og:title", content: title },
      { property: "og:type", content: type },
      { property: "og:url", content: url },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:image", content: image },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:image", content: image },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

// Head of a translated page: the canonical URL is the page in the current language,
// with an alternate for every language
export function pageHead(path: TranslatedPath, title: string, description: string) {
  const localized = (locale: (typeof locales)[number]) => localizeHref(path, { locale });
  const head = seoHead({ path: localized(getLocale()), title, description });
  return {
    meta: head.meta,
    links: [
      ...head.links,
      ...locales.map((locale) => ({
        rel: "alternate",
        hrefLang: locale,
        href: SITE_URL + localized(locale),
      })),
      { rel: "alternate", hrefLang: "x-default", href: SITE_URL + localized("en") },
    ],
  };
}
