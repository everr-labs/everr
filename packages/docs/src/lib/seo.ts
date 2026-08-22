import { getBaseUrl } from "./url";

/**
 * The four signals an agent needs to resolve a page to an entity: a canonical
 * URL, a declared language, an Open Graph type and an Open Graph image. Every
 * route builds its head through here so none of them is forgotten.
 */

export const SITE_NAME = "Everr";
export const DEFAULT_OG_IMAGE_PATH = "/api/og";

export type PageSeo = {
  title: string;
  description: string;
  /** Path with a leading slash, used for the canonical URL. */
  path: string;
  ogType?: "website" | "article" | "product";
  /** Absolute URL, or a path on this site. Defaults to the site card. */
  image?: string;
  publishedTime?: string;
};

export type HeadTags = {
  meta: Array<Record<string, string>>;
  links: Array<Record<string, string>>;
};

export function pageSeoTags(seo: PageSeo): HeadTags {
  const base = getBaseUrl();
  const url = canonicalUrl(seo.path, base);
  const image = absoluteUrl(seo.image ?? DEFAULT_OG_IMAGE_PATH, base);

  const meta: Array<Record<string, string>> = [
    { title: seo.title },
    { name: "description", content: seo.description },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:title", content: seo.title },
    { property: "og:description", content: seo.description },
    { property: "og:type", content: seo.ogType ?? "website" },
    { property: "og:url", content: url },
    { property: "og:image", content: image },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: seo.description },
    { property: "og:locale", content: "en_US" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:site", content: "@everrlabs" },
    { name: "twitter:title", content: seo.title },
    { name: "twitter:description", content: seo.description },
    { name: "twitter:image", content: image },
  ];

  if (seo.publishedTime) {
    meta.push({
      property: "article:published_time",
      content: seo.publishedTime,
    });
  }

  return {
    meta,
    links: [
      { rel: "canonical", href: url },
      { rel: "alternate", type: "text/markdown", href: markdownUrl(url) },
    ],
  };
}

export function canonicalUrl(path: string, base = getBaseUrl()): string {
  if (path === "/") return `${base}/`;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function absoluteUrl(pathOrUrl: string, base = getBaseUrl()): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  return `${base}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
}

/** The `.md` twin of a canonical URL, advertised as an alternate. */
export function markdownUrl(url: string): string {
  if (url.endsWith("/")) return `${url}index.md`;
  return `${url}.md`;
}
