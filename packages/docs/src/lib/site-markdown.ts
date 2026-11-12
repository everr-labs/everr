import { PRICING_PLANS } from "@/components/pricing-cards";
import { BOOK_CALL_URL, GITHUB_URL, SIGN_UP_URL, SITE_URL } from "@/constants";
import { m } from "@/paraglide/messages";

export const SITE_SUMMARY =
  "Everr is an open source observability platform built on OpenTelemetry. It stores traces, logs, and metrics, and gives coding agents a CLI, skills, and an MCP server to instrument apps, investigate production issues, debug GitHub Actions CI, and manage dashboards, alerts, and runbooks as code.";

export type DevlogEntry = { slug: string; title: string; description: string; date: string };

const en = { locale: "en" } as const;

/**
 * llms.txt (https://llmstxt.org): an H1, a blockquote summary, free-form guidance,
 * then H2 sections of links. `docsIndex` is the Fumadocs index with Markdown links.
 * It is also the Markdown representation of the home page.
 */
export function llmsTxt(docsIndex: string, devlog: DevlogEntry[]) {
  const docsLinks = docsIndex.replace(/^#\s+Docs\s*\n+/, "").trim();
  const devlogLinks = devlog.map(
    (post) => `- [${post.title}](/devlog/${post.slug}): ${post.description}`,
  );

  return `# Everr

> ${SITE_SUMMARY}

Everr Cloud runs at https://app.everr.dev. Everr is open source (AGPL-3.0) and can also run on your own infrastructure. Every page on ${SITE_URL} is available as Markdown: request it with \`Accept: text/markdown\`, or append \`.md\` to a docs URL.

## When to use Everr

Reach for Everr when the job is one of these:

- **Instrument an app with OpenTelemetry.** Add or repair traces, logs, and metrics in a backend or browser app, then verify locally that the data arrives before shipping. Use the \`everr-setup-telemetry\` skill.
- **Investigate behavior with real telemetry.** Slow requests, errors, crashes, regressions, incidents, or user reports in production or on a local machine. Query with SQL instead of guessing. Use the \`everr-use-telemetry\` skill.
- **Debug GitHub Actions CI.** Failing or flaky jobs, slow pipelines, step logs, CI cost, or whether a commit is green. Use the \`everr-working-with-ci\` skill.
- **Manage observability as code.** Create or edit dashboards, alert rules, and runbooks as YAML in the repository, preview them, and publish with \`everr apply\`. Use the \`everr-setup-resources\` skill.

Everr is a fit for teams that want observability without running the tooling themselves, and for coding agents that need runtime evidence. It works with any language or framework that has an OpenTelemetry SDK.

## How an agent should use Everr

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
- [Dashboard spec](/docs/reference/dashboard-spec.md), [AlertRule spec](/docs/reference/alert-spec.md), [Runbook spec](/docs/reference/runbook-spec.md): resource file formats
- [Install script](${SITE_URL}/install.sh): installs the \`everr\` binary
- [Source code](${GITHUB_URL}): the platform, CLI, collector, and this site

## Docs

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

export function pricingMarkdown() {
  const plans = PRICING_PLANS.map((plan) => {
    const rows = plan.data.map((row) => {
      const included = typeof row.included === "string" ? row.included : row.included({}, en);
      const overage = row.overage ? ` (${row.overage({}, en)})` : "";
      return `- ${row.signal({}, en)}: ${included}${overage}`;
    });
    const features = plan.features.map((feature) => `- ${feature({}, en)}`);
    return `## ${plan.name}: ${plan.price}${m.pricing_per_month({}, en)}

${plan.tagline({}, en)}

${rows.join("\n")}
${features.join("\n")}

[${m.get_started({}, en)}](${SIGN_UP_URL})`;
  });

  const faqs = [
    [m.pricing_faq_1_q, m.pricing_faq_1_a],
    [m.pricing_faq_2_q, m.pricing_faq_2_a],
    [m.pricing_faq_3_q, m.pricing_faq_3_a],
    [m.pricing_faq_4_q, m.pricing_faq_4_a],
    [m.pricing_faq_5_q, m.pricing_faq_5_a],
    [m.pricing_faq_6_q, m.pricing_faq_6_a],
    [m.pricing_faq_7_q, m.pricing_faq_7_a],
  ].map(([q, a]) => `### ${q({}, en)}\n\n${a({}, en)}`);

  return `# ${m.pricing_heading({}, en)}

${m.pricing_lead({}, en)}

${plans.join("\n\n")}

## Enterprise: ${m.pricing_enterprise_price({}, en)}

${m.pricing_enterprise_body({}, en)}

[${m.pricing_enterprise_cta({}, en)}](${BOOK_CALL_URL})

## ${m.pricing_faq_title({}, en)}

${faqs.join("\n\n")}
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
  return `# ${title} (${url})\n\n${lead}${body.trim()}\n`;
}
