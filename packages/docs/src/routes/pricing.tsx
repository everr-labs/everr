import { createFileRoute } from "@tanstack/react-router";
import { FAQ, type FaqItem } from "@/components/faq";
import { Footer } from "@/components/footer";
// import { PricingCalculator } from "@/components/pricing-calculator";
import { PricingCards } from "@/components/pricing-cards";
import { SelfHostedBanner } from "@/components/self-hosted-banner";

const PRICING_FAQS: FaqItem[] = [
  {
    q: "What counts toward ingestion?",
    a: "Only data we actually store counts toward ingestion. Logs, traces, and metrics sent to Everr but dropped before storage do not count toward your monthly usage.",
  },
  {
    q: "How does the query allowance work?",
    a: (
      <>
        We don't charge separately for data storage, so each plan has a query
        allowance to keep usage fair for everyone. It measures the data your
        queries scan, not the number of queries you run. If you need a different
        allowance,{" "}
        <a
          href="https://calendar.app.google/XnYJ4rHuTzDaNetFA"
          className="text-fd-foreground underline decoration-primary decoration-2 underline-offset-4 hover:text-primary"
        >
          contact us
        </a>
        .
      </>
    ),
  },
  {
    q: "How does retention work?",
    a: (
      <>
        Hobby keeps logs, traces, and metrics for 14 days; Pro keeps them for 12
        months. Each event gets the retention period of your plan when it
        arrives, so changing plans affects new data, not data already stored.
        Read the{" "}
        <a
          href="/docs/reference/retention"
          className="text-fd-foreground underline decoration-primary decoration-2 underline-offset-4 hover:text-primary"
        >
          retention guide
        </a>{" "}
        for details.
      </>
    ),
  },
  {
    q: "Is Hobby really free?",
    a: "Yes. Hobby is free forever, with no credit card required. The included quotas are designed to be generous enough for several hobby projects.",
  },
  {
    q: "How do additional costs work?",
    a: "You pay the Pro plan fee when you subscribe. Ingestion above the included 300 GB costs €0.10 per GB. At each monthly renewal, you pay for that additional usage from the month just ended together with the plan fee for the month ahead.",
  },
  {
    q: "Can I downgrade at any time?",
    a: "Yes. There is no minimum commitment, and you can cancel your subscription yourself at any time. Pro stays active until the end of the current billing cycle, then the subscription ends. Additional usage charges are frozen when you request the downgrade.",
  },
  {
    q: "Can I control and predict my costs?",
    a: "Yes. Pro has a fixed monthly fee and a published rate for additional ingestion, so you can estimate your costs. Monthly budget limits will be available soon.",
  },
];

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
});

function PricingPage() {
  return (
    <div className="overflow-x-clip">
      <PricingCards />
      {/* <PricingCalculator /> */}
      <SelfHostedBanner />
      <FAQ
        items={PRICING_FAQS}
        title="Pricing questions"
        contactPrompt="Need help choosing a plan?"
      />
      <Footer />
    </div>
  );
}
