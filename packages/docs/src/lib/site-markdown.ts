import { PRICING_PLANS } from "@/components/pricing-cards";
import { BOOK_CALL_URL, GITHUB_URL, SIGN_UP_URL, SITE_URL } from "@/constants";
import { m } from "@/paraglide/messages";
import type { Locale } from "@/paraglide/runtime";
import { stripHeadingIds } from "./heading-ids";

export const SITE_SUMMARY =
  "Everr is an open source observability platform built on OpenTelemetry. It stores traces, logs, and metrics, and gives coding agents a CLI, skills, and an MCP server to instrument apps, investigate production issues, debug GitHub Actions CI, and manage dashboards, alerts, and runbooks as code.";

export type DevlogEntry = { slug: string; title: string; description: string; date: string };

const LINK_ITEM = /^\s*- (\[[^\]]+\]\([^)]+\).*)$/;
const GROUP_ITEM = /^- (.+)$/;

/**
 * The Fumadocs index as llms.txt sections: llms.txt sections hold only link lists, so
 * each top-level folder becomes an H2 and the links lose their nesting. Sub-group
 * labels without a link (such as **CI**) are dropped; the links stay.
 */
export function docsSections(docsIndex: string) {
  const sections: { title: string; links: string[] }[] = [{ title: "Docs", links: [] }];
  for (const line of docsIndex.split("\n")) {
    const link = LINK_ITEM.exec(line);
    if (link) {
      sections.at(-1)?.links.push(`- ${link[1]}`);
      continue;
    }
    const group = GROUP_ITEM.exec(line);
    if (group) sections.push({ title: `Docs: ${group[1]}`, links: [] });
  }
  return sections
    .filter((section) => section.links.length > 0)
    .map((section) => `## ${section.title}\n\n${section.links.join("\n")}`)
    .join("\n\n");
}

/**
 * llms.txt (https://llmstxt.org): an H1, a blockquote summary, free-form guidance with
 * no headings, then H2 sections that hold only lists of links. `docsIndex` is the Fumadocs index with Markdown links.
 * It is also the Markdown representation of the home page.
 */
export function llmsTxt(docsIndex: string, devlog: DevlogEntry[]) {
  const docsLinks = docsSections(docsIndex);
  const devlogLinks = devlog.map(
    (post) => `- [${post.title}](/devlog/${post.slug}): ${post.description}`,
  );

  return `# Everr

> ${SITE_SUMMARY}

Everr Cloud runs at https://app.everr.dev. Everr is open source (AGPL-3.0) and can also run on your own infrastructure. Every page on ${SITE_URL} is available as Markdown: request it with \`Accept: text/markdown\`, or append \`.md\` to a docs URL.

**When to use Everr.** Reach for Everr when the job is one of these:

- **Instrument an app with OpenTelemetry.** Add or repair traces, logs, and metrics in a backend or browser app, then verify locally that the data arrives before shipping. Use the \`everr-setup-telemetry\` skill.
- **Investigate behavior with real telemetry.** Slow requests, errors, crashes, regressions, incidents, or user reports in production or on a local machine. Query with SQL instead of guessing. Use the \`everr-use-telemetry\` skill.
- **Debug GitHub Actions CI.** Failing or flaky jobs, slow pipelines, step logs, CI cost, or whether a commit is green. Use the \`everr-working-with-ci\` skill.
- **Manage observability as code.** Create or edit dashboards, alert rules, and runbooks as YAML in the repository, preview them, and publish with \`everr apply\`. Use the \`everr-setup-resources\` skill.

Everr is a fit for teams that want observability without running the tooling themselves, and for coding agents that need runtime evidence. It works with any language or framework that has an OpenTelemetry SDK.

**How an agent should use Everr:**

1. Install the CLI (macOS arm64, Linux x86_64 and arm64): \`curl -fsSL ${SITE_URL}/install.sh | sh\`
2. Install the skills from the project root: \`everr skills install --all --project\`
3. For local telemetry, run \`everr local start\` and query with \`everr local query "<SQL>"\`. No account is needed.
4. For Everr Cloud or a self-hosted installation, a person runs \`everr cloud login\` once to approve the session in a browser. Then use \`everr cloud status --json\` for the OTLP ingest endpoint and \`everr cloud query "<SQL>"\` for read-only SQL.
5. For CI, run \`everr ci status\` for the current commit, or \`everr ci watch\` to wait for it.
6. AI clients without a shell can connect to the read-only MCP server at https://app.everr.dev/mcp (Streamable HTTP, OAuth 2.1).

Ask the user before publishing resources with \`everr apply\` or deleting them.

## Developer resources

- [CLI reference](/docs/reference/cli.md): every Everr CLI command and flag
- [MCP server](/docs/reference/mcp.md): endpoint, transport, auth, and client setup
- [Skills](/docs/reference/skills.md): bundled agent skills and how to install them
- [Production telemetry](/docs/guides/production-telemetry.md): send OTLP traces, logs, and metrics to Everr
- [Browser telemetry](/docs/guides/browser-telemetry.md): the \`@everr/otel-web\` SDK and public ingest keys
- [Dashboard spec](/docs/reference/dashboard-spec.md): the dashboard file format
- [AlertRule spec](/docs/reference/alert-spec.md): the alert rule file format
- [Runbook spec](/docs/reference/runbook-spec.md): the runbook file format
- [Install script](${SITE_URL}/install.sh): installs the \`everr\` binary
- [Source code](${GITHUB_URL}): the platform, CLI, collector, and this site

${docsLinks}

## Company

- [About](/about): what Everr is and who builds it
- [Pricing](/pricing): plans, quotas, and what counts toward usage
- [Contact](/contact): support, sales, and bug reports; email hello@everr.dev
- [Privacy](/privacy): what this website collects

## Optional

- [Devlog](/devlog): weekly updates from the Everr team
${devlogLinks.join("\n")}
`;
}

type MessagePart = { type: string; value?: string };

// A paraglide message with one {#link}…{/link} span, as Markdown
function partsToMarkdown(parts: MessagePart[], href: string) {
  return parts
    .map((part) => {
      if (part.type === "text") return part.value ?? "";
      if (part.type === "markup-start") return "[";
      if (part.type === "markup-end") return `](${href})`;
      return "";
    })
    .join("");
}

export function pricingMarkdown(locale: Locale) {
  const options = { locale };
  const plans = PRICING_PLANS.map((plan) => {
    const rows = plan.data.map((row) => {
      const included = typeof row.included === "string" ? row.included : row.included({}, options);
      const overage = row.overage ? ` (${row.overage({}, options)})` : "";
      return `- ${row.signal({}, options)}: ${included}${overage}`;
    });
    const features = plan.features.map((feature) => `- ${feature({}, options)}`);
    return `## ${plan.name}: ${plan.price}${m.pricing_per_month({}, options)}

${plan.tagline({}, options)}

${rows.join("\n")}
${features.join("\n")}

[${plan.cta({}, options)}](${SIGN_UP_URL})`;
  });

  // Two answers link out with paraglide markup: keep the link as a Markdown link
  const faqs: [string, string][] = [
    [m.pricing_faq_1_q({}, options), m.pricing_faq_1_a({}, options)],
    [
      m.pricing_faq_2_q({}, options),
      partsToMarkdown(m.pricing_faq_2_a.parts({}, options), BOOK_CALL_URL),
    ],
    [
      m.pricing_faq_3_q({}, options),
      partsToMarkdown(m.pricing_faq_3_a.parts({}, options), "/docs/reference/retention"),
    ],
    [m.pricing_faq_4_q({}, options), m.pricing_faq_4_a({}, options)],
    [m.pricing_faq_5_q({}, options), m.pricing_faq_5_a({}, options)],
    [m.pricing_faq_6_q({}, options), m.pricing_faq_6_a({}, options)],
    [m.pricing_faq_7_q({}, options), m.pricing_faq_7_a({}, options)],
  ];
  const faqText = faqs.map(([q, a]) => `### ${q}\n\n${a}`);

  return `# ${m.pricing_heading({}, options)}

${m.pricing_lead({}, options)}

${plans.join("\n\n")}

## Enterprise: ${m.pricing_enterprise_price({}, options)}

${m.pricing_enterprise_body({}, options)}

[${m.pricing_enterprise_cta({}, options)}](${BOOK_CALL_URL})

## ${m.pricing_faq_title({}, options)}

${faqText.join("\n\n")}
`;
}

export function devlogIndexMarkdown(devlog: DevlogEntry[]) {
  const posts = devlog.map(
    (post) => `- ${post.date}: [${post.title}](/devlog/${post.slug}): ${post.description}`,
  );
  return `# Everr Devlog

Weekly updates on what we're building, success stories, and use cases from the Everr team.

${posts.join("\n")}
`;
}

export function pageMarkdown(title: string, url: string, body: string, description?: string) {
  const lead = description ? `> ${description}\n\n` : "";
  return `# ${title} (${url})\n\n${lead}${stripHeadingIds(body).trim()}\n`;
}
