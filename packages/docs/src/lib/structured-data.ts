import {
  CONTACT_EMAIL,
  DISCORD_URL,
  GITHUB_URL,
  LINKEDIN_URL,
  POSTAL_ADDRESS,
  X_URL,
} from "../content/trust-pages";
import { EVERR_SUMMARY } from "./agent-guide";
import { getBaseUrl } from "./url";

/**
 * JSON-LD for the homepage: who Everr Labs is and what Everr is.
 *
 * Kept to claims the site can back up. The postal address appears only once
 * `POSTAL_ADDRESS` is filled in, and no phone number is asserted at all.
 */

const ORGANIZATION_ID = "#organization";
const WEBSITE_ID = "#website";
const SOFTWARE_ID = "#software";

function organizationSchema(base = getBaseUrl()) {
  return {
    "@type": "Organization",
    "@id": `${base}/${ORGANIZATION_ID}`,
    name: "Everr Labs",
    alternateName: "Everr",
    url: `${base}/`,
    logo: `${base}/favicon.ico`,
    description:
      "Everr Labs builds Everr, an OpenTelemetry observability platform for logs, traces, metrics, dashboards, alerts and runbooks.",
    email: CONTACT_EMAIL,
    sameAs: [GITHUB_URL, X_URL, LINKEDIN_URL, DISCORD_URL],
    ...(POSTAL_ADDRESS
      ? { address: { "@type": "PostalAddress", ...POSTAL_ADDRESS } }
      : {}),
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: CONTACT_EMAIL,
        url: `${base}/contact`,
        availableLanguage: ["English"],
      },
      {
        "@type": "ContactPoint",
        contactType: "technical support",
        email: CONTACT_EMAIL,
        url: `${base}/docs`,
        availableLanguage: ["English"],
      },
      {
        "@type": "ContactPoint",
        contactType: "security",
        email: CONTACT_EMAIL,
        url: `${base}/contact`,
        availableLanguage: ["English"],
      },
    ],
  };
}

function webSiteSchema(base = getBaseUrl()) {
  return {
    "@type": "WebSite",
    "@id": `${base}/${WEBSITE_ID}`,
    name: "Everr",
    url: `${base}/`,
    description: EVERR_SUMMARY,
    inLanguage: "en",
    publisher: { "@id": `${base}/${ORGANIZATION_ID}` },
  };
}

function softwareApplicationSchema(base = getBaseUrl()) {
  return {
    "@type": "SoftwareApplication",
    "@id": `${base}/${SOFTWARE_ID}`,
    name: "Everr",
    url: `${base}/`,
    description: EVERR_SUMMARY,
    applicationCategory: "DeveloperApplication",
    applicationSubCategory: "Observability",
    operatingSystem: "macOS, Linux, Web",
    softwareHelp: { "@type": "CreativeWork", url: `${base}/docs` },
    downloadUrl: `${base}/docs/learn/install`,
    installUrl: `${base}/install.sh`,
    featureList: [
      "OpenTelemetry logs, traces and metrics",
      "Dashboards, alert rules and runbooks stored as code",
      "GitHub Actions CI runs as traces",
      "Read-only SQL over stored telemetry",
      "Local collector and desktop app",
      "MCP server and CLI for coding agents",
    ],
    offers: [
      {
        "@type": "Offer",
        name: "Free",
        price: "0",
        priceCurrency: "USD",
        url: `${base}/pricing`,
        description:
          "Traces, logs and metrics kept for 30 days, with an included ingest volume.",
      },
      {
        "@type": "Offer",
        name: "Pro",
        priceCurrency: "USD",
        url: `${base}/pricing`,
        description:
          "Traces and logs kept for 90 days, metrics for 13 months, priced on ingest volume.",
      },
    ],
    publisher: { "@id": `${base}/${ORGANIZATION_ID}` },
    isAccessibleForFree: true,
  };
}

/** The graph the homepage embeds. */
export function homepageJsonLd(base = getBaseUrl()) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationSchema(base),
      webSiteSchema(base),
      softwareApplicationSchema(base),
    ],
  };
}

/** The graph every other page embeds: identity without the product claims. */
export function sitewideJsonLd(base = getBaseUrl()) {
  return {
    "@context": "https://schema.org",
    "@graph": [organizationSchema(base), webSiteSchema(base)],
  };
}

export function jsonLdScript(data: unknown) {
  return {
    type: "application/ld+json",
    children: JSON.stringify(data),
  };
}
