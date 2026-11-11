import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@everr/ui/components/collapsible";
import { ParaglideMessage } from "@inlang/paraglide-js-react";
import { Plus } from "lucide-react";
import { type ReactNode, useState } from "react";
import { sectionHeading, sectionWrap } from "@/components/ui/type";
import { m } from "@/paraglide/messages";

export type FaqItem = {
  q: string;
  a: ReactNode;
};

const inlineCode = ({ children }: { children?: ReactNode }) => (
  <code className="font-mono text-[0.95em] text-fd-foreground">{children}</code>
);

const homeFaqs = (): FaqItem[] => [
  { q: m.faq_1_q(), a: m.faq_1_a() },
  { q: m.faq_2_q(), a: m.faq_2_a() },
  { q: m.faq_3_q(), a: m.faq_3_a() },
  { q: m.faq_4_q(), a: m.faq_4_a() },
  { q: m.faq_5_q(), a: <ParaglideMessage message={m.faq_5_a} markup={{ code: inlineCode }} /> },
  { q: m.faq_6_q(), a: m.faq_6_a() },
];

export function FAQ({
  items = homeFaqs(),
  title = m.faq_heading(),
  contactPrompt = m.faq_contact_prompt(),
}: {
  items?: FaqItem[];
  title?: string;
  contactPrompt?: string;
}) {
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);

  return (
    <section className="border-t border-border">
      <div className={`${sectionWrap} py-20 md:py-32`}>
        <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] md:gap-20">
          <div>
            <h2 className={sectionHeading}>{title}</h2>
            <p className="mt-6 max-w-sm text-base leading-relaxed text-fd-muted-foreground">
              {contactPrompt}{" "}
              <a
                href="https://everr.dev/discord"
                className="text-fd-foreground underline decoration-primary decoration-2 underline-offset-4 hover:text-primary"
              >
                {m.faq_contact_link()}
              </a>
              .
            </p>
          </div>

          <ul className="border-t border-fd-border">
            {items.map((item) => (
              <FaqRow
                key={item.q}
                item={item}
                open={openQuestion === item.q}
                onOpenChange={(open) => setOpenQuestion(open ? item.q : null)}
              />
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function FaqRow({
  item,
  open,
  onOpenChange,
}: {
  item: FaqItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <li>
      <Collapsible
        open={open}
        onOpenChange={onOpenChange}
        className="group/faq border-b border-fd-border"
      >
        <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-6 py-6 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
          <span className="text-xl leading-[1.25] font-medium tracking-[-0.02em] text-fd-foreground transition-colors group-hover/faq:text-primary md:text-2xl">
            {item.q}
          </span>
          <Plus
            aria-hidden
            className="size-5 shrink-0 text-fd-muted-foreground transition-transform duration-300 ease-out group-hover/faq:text-primary group-data-[open]/faq:rotate-45"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="overflow-hidden text-sm leading-relaxed text-fd-muted-foreground transition-[height] duration-300 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 md:text-base h-[var(--collapsible-panel-height)]">
          <p className="max-w-[62ch] pb-6">{item.a}</p>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
