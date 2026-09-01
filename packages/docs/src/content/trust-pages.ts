/**
 * The prose behind /about, /contact and /privacy.
 *
 * These pages are rendered as HTML for people and serialized to Markdown for
 * agents, so the text lives here once instead of in two places that drift.
 */

export type TrustSection = {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type TrustPage = {
  path: string;
  title: string;
  /** The `<title>` tag. Always names Everr, so a search for the product finds it. */
  metaTitle: string;
  /** The `<h1>` and the Markdown `#` heading. */
  headline: string;
  description: string;
  intro: string[];
  sections: TrustSection[];
};

/** Absolute, so the Markdown twin still works when read away from the site. */
export const SITE_URL = "https://everr.dev";
export const CONTACT_EMAIL = "hello@everr.dev";
export const GITHUB_URL = "https://github.com/everr-labs/everr";
export const DISCORD_URL = "https://discord.gg/hd6yYDjAuw";
export const X_URL = "https://x.com/everrlabs";

export const LINKEDIN_URL = "https://www.linkedin.com/company/everr-labs";

/**
 * The registered postal address, once Everr Labs publishes one.
 *
 * Schema.org `Organization.address` is what lets an assistant answer "is this
 * a real business", so it is worth filling in. It is `null` rather than
 * invented: a wrong address is worse than a missing one. Set the four fields
 * and the homepage JSON-LD picks it up.
 */
export const POSTAL_ADDRESS: {
  streetAddress: string;
  addressLocality: string;
  postalCode: string;
  addressCountry: string;
} | null = null;

export const ABOUT_PAGE: TrustPage = {
  path: "/about",
  title: "About Everr",
  metaTitle: "About Everr",
  headline: "About Everr",
  description:
    "Everr Labs builds Everr, an OpenTelemetry observability platform for teams that want deep insight without a dedicated telemetry team.",
  intro: [
    "Everr is an observability platform built by Everr Labs. It collects the logs, traces and metrics your software already produces, and it gives you dashboards, alerts and runbooks you can keep in your repository next to the code they watch.",
    "We started Everr because observability tooling did not keep up with the rest of web development. Setting up a competent telemetry stack still costs days, and running one usually costs a dedicated engineer. Teams that ship fast end up with no insight at all.",
  ],
  sections: [
    {
      heading: "What we build",
      bullets: [
        "A hosted backend that stores OpenTelemetry data from your production services, your CI runs and your browser sessions.",
        "A desktop app with a local collector, so you can read your own telemetry on your machine with no cloud account.",
        "A command line tool, called everr, that installs the collector, queries telemetry with SQL, and applies dashboards, runbooks and alert rules from files.",
        "A GitHub App that turns every GitHub Actions run into a trace, so a red build is something you can query instead of something you scroll.",
        "An MCP server and a set of agent skills, so a coding agent reads the same telemetry you do.",
      ],
    },
    {
      heading: "How we build it",
      paragraphs: [
        "Everything is OpenTelemetry underneath. We follow the OpenTelemetry semantic conventions, and we store data in an open query model you can read with SQL. Nothing you instrument is locked to us: point the same exporter somewhere else and it keeps working.",
        "Dashboards, alert rules and runbooks are plain files. You review them in a pull request, diff them, and roll them back the same way you handle code. People and coding agents can both edit them, because they are text.",
      ],
    },
    {
      heading: "Open source",
      paragraphs: [
        `Everr is developed in the open at ${GITHUB_URL}. You can read the code, file issues, and follow what changed at ${SITE_URL}/devlog.`,
      ],
    },
    {
      heading: "Who we are",
      paragraphs: [
        "Everr Labs is a small team of web and infrastructure developers. We use Everr to run Everr: the dashboards and alert rules in our own repository are the ones you can read in the documentation.",
      ],
    },
  ],
};

export const CONTACT_PAGE: TrustPage = {
  path: "/contact",
  title: "Contact Everr",
  metaTitle: "Contact Everr",
  headline: "Contact Everr",
  description:
    "How to reach Everr Labs for support, security reports, sales questions, and bug reports.",
  intro: [
    `Email ${CONTACT_EMAIL} for anything. It reaches the people who build Everr, and it is the fastest route for support, billing and sales questions.`,
  ],
  sections: [
    {
      heading: "Support",
      paragraphs: [
        `Email ${CONTACT_EMAIL} with your organization name and what you were doing when the problem appeared. If the problem is in a CI run or a trace, send the link from the Everr app: it carries the identifiers we need.`,
        `The Discord server at ${DISCORD_URL} is the place for quick questions and for talking to other users. It is not monitored for anything urgent or private.`,
      ],
    },
    {
      heading: "Bugs and feature requests",
      paragraphs: [
        `Open an issue at ${GITHUB_URL}/issues. Public issues get answered faster than email, because the whole team sees them.`,
      ],
    },
    {
      heading: "Security",
      paragraphs: [
        `Report a vulnerability to ${CONTACT_EMAIL} with "security" in the subject. Please do not open a public issue for it. Tell us how to reproduce the problem and we will confirm receipt and keep you updated until it is fixed.`,
      ],
    },
    {
      heading: "Sales, plans and retention",
      paragraphs: [
        `Plans and prices are at ${SITE_URL}/pricing, and the retention window each plan gives you is at ${SITE_URL}/docs/reference/retention. If you need a retention window, a contract or an invoicing arrangement that the plans do not cover, email ${CONTACT_EMAIL}.`,
      ],
    },
    {
      heading: "Elsewhere",
      bullets: [
        `GitHub: ${GITHUB_URL}`,
        `Discord: ${DISCORD_URL}`,
        `X: ${X_URL}`,
        `LinkedIn: ${LINKEDIN_URL}`,
      ],
    },
  ],
};

export const PRIVACY_PAGE: TrustPage = {
  path: "/privacy",
  title: "Privacy policy",
  metaTitle: "Privacy policy - Everr",
  headline: "Privacy policy",
  description:
    "What data Everr collects, why it collects it, how long it keeps it, and how to have it removed.",
  intro: [
    "This page describes what Everr Labs collects when you use everr.dev, the Everr app, the Everr CLI and the Everr desktop app, and what we do with it.",
  ],
  sections: [
    {
      heading: "Data you send us",
      paragraphs: [
        "The telemetry you export to Everr Cloud is yours. It is stored per organization, and only members of your organization and the API keys you mint can read it. We do not sell it, and we do not use it to train models.",
        "Telemetry can contain whatever your instrumentation puts in it, including request paths, user identifiers and log messages. Everr does not inspect it for content. Decide what your services attach to spans and logs before you export them.",
      ],
    },
    {
      heading: "How long we keep telemetry",
      paragraphs: [
        `Retention depends on your plan. On the free plan, traces, logs and metrics are kept for 30 days. On Pro, traces and logs are kept for 90 days and metrics for 13 months. Data outside the window is deleted automatically and cannot be recovered. The full rules, including what happens when you change plan, are at ${SITE_URL}/docs/reference/retention.`,
      ],
    },
    {
      heading: "Account data",
      paragraphs: [
        "When you create an account we store your email address, your display name and, if your identity provider supplies one, your avatar URL. We store which organization you belong to and your role in it. This is what an account needs to work, and we use it for authentication, billing and service email.",
      ],
    },
    {
      heading: "GitHub data",
      paragraphs: [
        "If you install the Everr GitHub App, we receive workflow run events for the repositories you grant it. From those we store run, job and step metadata, the logs GitHub exposes for them, commit SHAs, branch names and the author email recorded on the commit. We do not read your source code.",
      ],
    },
    {
      heading: "This website",
      paragraphs: [
        "everr.dev uses PostHog for product analytics, which records page views and interface events, and it uses Everr's own browser SDK to record page performance and errors. Both are used to understand how the site and the product are used. The site does not run advertising trackers.",
      ],
    },
    {
      heading: "The desktop app and the local collector",
      paragraphs: [
        "The desktop app runs a collector on your machine. Telemetry that goes to the local collector stays on your machine and is not sent to Everr Cloud. It is kept for 7 days and then removed.",
      ],
    },
    {
      heading: "Subprocessors",
      paragraphs: [
        "We use third party providers for hosting, storage, error reporting, product analytics, payments and email. Each of them handles only the data it needs to provide its part of the service. Email us for the current list.",
      ],
    },
    {
      heading: "Your choices",
      bullets: [
        "Export or delete your telemetry at any time with the Everr CLI or the app.",
        "Uninstall the GitHub App to stop CI ingestion. The data already ingested rolls off with your retention window, or ask us to delete it now.",
        `Ask us to delete your account and everything attached to it by emailing ${CONTACT_EMAIL}. We confirm when it is done.`,
      ],
    },
    {
      heading: "Changes and contact",
      paragraphs: [
        `We update this page when what we collect changes. For any privacy question, or to exercise a request about your data, email ${CONTACT_EMAIL}.`,
      ],
    },
  ],
};

export const TRUST_PAGES: TrustPage[] = [
  ABOUT_PAGE,
  CONTACT_PAGE,
  PRIVACY_PAGE,
];

export function findTrustPage(path: string): TrustPage | undefined {
  return TRUST_PAGES.find((page) => page.path === path);
}

export function trustPageMarkdown(page: TrustPage): string {
  const lines: string[] = [`# ${page.headline}`, ""];

  for (const paragraph of page.intro) {
    lines.push(paragraph, "");
  }

  for (const section of page.sections) {
    lines.push(`## ${section.heading}`, "");

    for (const paragraph of section.paragraphs ?? []) {
      lines.push(paragraph, "");
    }

    if (section.bullets?.length) {
      for (const bullet of section.bullets) {
        lines.push(`- ${bullet}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
