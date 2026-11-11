import { SITE_URL } from "@/constants";
import { locales, localizeHref } from "@/paraglide/runtime";

// Title, description and the language alternates of a translated page
export function pageHead(path: "/" | "/pricing", title: string, description: string) {
  // Always the production address: search engines read these, and the server and the browser
  // have to render the same value
  const url = (locale: (typeof locales)[number]) => SITE_URL + localizeHref(path, { locale });
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
    links: [
      ...locales.map((locale) => ({ rel: "alternate", hrefLang: locale, href: url(locale) })),
      { rel: "alternate", hrefLang: "x-default", href: url("en") },
    ],
  };
}
