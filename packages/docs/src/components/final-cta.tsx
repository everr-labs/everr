import { Link } from "@tanstack/react-router";
import { Mascot } from "@/components/mascot";
import { sectionWrap } from "@/components/ui/type";
import { SIGN_UP_URL } from "@/constants";

const action =
  "inline-flex h-14 items-center justify-center rounded-full px-7 text-base font-semibold transition-transform duration-200 ease-out-expo hover:scale-[1.03] active:scale-[0.98] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-foreground";

export function FinalCTA() {
  return (
    <section className="overflow-hidden bg-primary text-primary-foreground selection:bg-primary-foreground selection:text-primary">
      <div
        className={`${sectionWrap} relative grid gap-10 pt-20 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:gap-8 md:pt-32`}
      >
        <div className="pb-4 md:pb-32">
          <h2 className="display max-w-[12ch] text-[clamp(2.75rem,6.6vw,6.5rem)]">
            Stop finding out from your customers
          </h2>
          <p className="mt-7 max-w-[40ch] text-lg leading-[1.5] text-pretty md:text-xl">
            Set Everr up today. Your AI assistant does most of the work, and you can see it working
            before anything ships.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a href={SIGN_UP_URL} className={`${action} bg-primary-foreground text-primary`}>
              Get started
            </a>
            <Link
              to="/docs/$"
              params={{ _splat: "" }}
              className={`${action} border-2 border-primary-foreground/80`}
            >
              Read the docs
            </Link>
          </div>
        </div>
        <Mascot className="-mb-[7%] w-[min(78vw,23rem)] justify-self-end md:w-[clamp(18rem,32vw,29rem)]" />
      </div>
    </section>
  );
}
