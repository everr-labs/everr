import { ParaglideMessage } from "@inlang/paraglide-js-react";
import { createFileRoute } from "@tanstack/react-router";
import { FAQ, type FaqItem } from "@/components/faq";
import { FinalCTA } from "@/components/final-cta";
import { Footer } from "@/components/footer";
import { PricingCards } from "@/components/pricing-cards";
import { SelfHostedBanner } from "@/components/self-hosted-banner";
import { BOOK_CALL_URL } from "@/constants";
import { pageHead } from "@/lib/page-head";
import { m } from "@/paraglide/messages";

const faqLink =
  "text-fd-foreground underline decoration-primary decoration-2 underline-offset-4 hover:text-primary";

const pricingFaqs = (): FaqItem[] => [
  { q: m.pricing_faq_1_q(), a: m.pricing_faq_1_a() },
  {
    q: m.pricing_faq_2_q(),
    a: (
      <ParaglideMessage
        message={m.pricing_faq_2_a}
        markup={{
          link: ({ children }) => (
            <a href={BOOK_CALL_URL} className={faqLink}>
              {children}
            </a>
          ),
        }}
      />
    ),
  },
  {
    q: m.pricing_faq_3_q(),
    a: (
      <ParaglideMessage
        message={m.pricing_faq_3_a}
        markup={{
          link: ({ children }) => (
            <a href="/docs/reference/retention" className={faqLink}>
              {children}
            </a>
          ),
        }}
      />
    ),
  },
  { q: m.pricing_faq_4_q(), a: m.pricing_faq_4_a() },
  { q: m.pricing_faq_5_q(), a: m.pricing_faq_5_a() },
  { q: m.pricing_faq_6_q(), a: m.pricing_faq_6_a() },
  { q: m.pricing_faq_7_q(), a: m.pricing_faq_7_a() },
];

export const Route = createFileRoute("/pricing")({
  component: PricingPage,
  head: () => pageHead("/pricing", m.meta_pricing_title(), m.pricing_lead()),
});

function PricingPage() {
  return (
    <div className="overflow-x-clip">
      <PricingCards />
      <SelfHostedBanner />
      <FAQ
        items={pricingFaqs()}
        title={m.pricing_faq_title()}
        contactPrompt={m.pricing_faq_contact()}
      />
      <FinalCTA />
      <Footer />
    </div>
  );
}
