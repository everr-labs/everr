import {
  CONTACT_EMAIL,
  DISCORD_URL,
  GITHUB_ORG_URL,
  GITHUB_URL,
  LINKEDIN_URL,
  SIGN_UP_URL,
  SITE_URL,
  X_URL,
} from "@/constants";
import { SITE_SUMMARY } from "./site-markdown";

const ORGANIZATION_ID = `${SITE_URL}/#organization`;

// schema.org identity of the site: who makes Everr and what it is (https://schema.org)
export function siteStructuredData() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORGANIZATION_ID,
        name: "Everr",
        url: SITE_URL,
        email: CONTACT_EMAIL,
        logo: `${SITE_URL}/logo.png`,
        description: SITE_SUMMARY,
        sameAs: [GITHUB_ORG_URL, X_URL, LINKEDIN_URL, DISCORD_URL],
        contactPoint: [
          {
            "@type": "ContactPoint",
            contactType: "customer support",
            email: CONTACT_EMAIL,
            url: `${SITE_URL}/contact`,
          },
        ],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: "Everr",
        url: SITE_URL,
        inLanguage: ["en", "it"],
        publisher: { "@id": ORGANIZATION_ID },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#software`,
        name: "Everr",
        description: SITE_SUMMARY,
        url: SITE_URL,
        applicationCategory: "DeveloperApplication",
        operatingSystem: "Web, macOS, Linux",
        license: "https://www.gnu.org/licenses/agpl-3.0.html",
        sameAs: [GITHUB_URL],
        softwareHelp: { "@type": "WebPage", url: `${SITE_URL}/docs` },
        installUrl: SIGN_UP_URL,
        downloadUrl: `${SITE_URL}/install.sh`,
        publisher: { "@id": ORGANIZATION_ID },
      },
    ],
  };
}

// A <script type="application/ld+json"> for a route's head. `<` is escaped so the
// JSON cannot close the script element
export function jsonLdScript(data: unknown) {
  return {
    type: "application/ld+json",
    children: JSON.stringify(data).replaceAll("<", "\\u003c"),
  };
}
