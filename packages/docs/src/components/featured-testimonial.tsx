import { sectionWrap } from "@/components/ui/type";
import { m } from "@/paraglide/messages";

import skillvueLogo from "../assets/logos/skillvue.svg?url";
import marcelloPhoto from "../assets/testimonials/marcello.jpeg?url";

export function FeaturedTestimonial() {
  return (
    <section className="border-t border-border bg-fd-background text-foreground">
      <figure
        className={`${sectionWrap} grid gap-10 py-20 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-16 md:py-36`}
      >
        <figcaption className="flex items-center gap-4 md:flex-col md:items-start md:gap-5 md:pt-3">
          <img
            src={marcelloPhoto}
            alt=""
            className="size-16 rounded-full object-cover md:size-20"
          />
          <div>
            <div className="text-base font-semibold">Marcello Roherssen</div>
            <div className="mt-0.5 text-sm text-muted-foreground">{m.testimonial_role()}</div>
            <img src={skillvueLogo} alt="" className="mt-4 h-6 w-auto max-md:hidden" />
          </div>
        </figcaption>
        <blockquote className="max-w-[34ch] text-[clamp(1.5rem,2.9vw,2.625rem)] leading-[1.22] font-medium tracking-[-0.03em] text-pretty">
          <p>{m.testimonial_p1()}</p>
          <p className="mt-[0.6em]">{m.testimonial_p2()}</p>
          <p className="mt-[0.6em] text-primary">{m.testimonial_closing()}</p>
        </blockquote>
      </figure>
    </section>
  );
}
