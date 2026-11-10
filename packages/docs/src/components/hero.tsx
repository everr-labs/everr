import { cn } from "@everr/ui/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Mascot } from "@/components/mascot";
import { Button } from "@/components/ui/button";
import { SIGN_UP_URL } from "@/constants";

const ease = [0.16, 1, 0.3, 1] as const;
const LINES = ["Know before", "your customers do"];

// What Everr says when it notices something, one at a time
const NOTICES = [
  {
    time: "09:41",
    what: "Checkout is slow for 1 in 5 people",
    why: "One database query, shipped yesterday.",
  },
  {
    time: "14:02",
    what: "Sign-ups stopped working on Safari",
    why: "It started with the last release.",
  },
  {
    time: "22:17",
    what: "Large photo uploads are failing",
    why: "The person on call has the steps to fix it.",
  },
];
const SHOW_MS = 5200;
const REST_MS = 2200;

// Everr notices something, says it, then goes back to watching
function useNotices() {
  const [state, setState] = useState({ index: 0, on: true });
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setTimeout(
      () =>
        setState(({ index, on }) =>
          on ? { index, on: false } : { index: (index + 1) % NOTICES.length, on: true },
        ),
      state.on ? SHOW_MS : REST_MS,
    );
    return () => clearTimeout(id);
  }, [state]);
  return state;
}

export function Hero() {
  const { index, on } = useNotices();
  const notice = NOTICES[index];

  return (
    <section className="relative -mt-16 min-h-[max(100svh,46rem)] overflow-hidden bg-background pt-16 text-foreground md:-mt-24 md:pt-24">
      <div className="relative z-10 mx-auto max-w-7xl px-4 pt-10 sm:px-6 md:pt-[clamp(1rem,3vh,3rem)]">
        <h1 className="display text-[clamp(2.375rem,min(9vw,14.5vh),9rem)]">
          {LINES.map((line, i) => (
            // The clip is taller than the line box, so descenders survive the reveal
            <span key={line} className="-mb-[0.14em] block overflow-hidden pb-[0.14em]">
              <motion.span
                className="block"
                initial={{ y: "110%" }}
                animate={{ y: 0 }}
                transition={{ duration: 0.9, delay: 0.05 + i * 0.09, ease }}
              >
                {line}
              </motion.span>
            </span>
          ))}
        </h1>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.35, ease }}
          className="mt-7 max-w-[30rem] md:mt-10"
        >
          <p className="text-lg leading-[1.5] text-pretty text-foreground/75 md:text-xl">
            Everr keeps watch over your app. When a page slows down or something breaks, it tells
            you what happened, where, and why. No specialist team required.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              nativeButton={false}
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- content is injected by Button
              render={<a href={SIGN_UP_URL} />}
            >
              Get started
            </Button>
            <Button
              variant="secondary"
              nativeButton={false}
              // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- content is injected by Button
              render={<a href="#tour" />}
            >
              See it in action
            </Button>
          </div>
        </motion.div>
      </div>

      {/* Everr itself, keeping watch from the corner of the page */}
      <motion.div
        initial={{ y: "30%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 1.3, delay: 0.4, ease }}
        className="relative mx-auto mt-44 w-[min(88vw,26rem)] md:absolute md:right-[max(1.5rem,calc((100vw-80rem)/2+1.5rem))] md:bottom-0 md:mt-0 md:w-[clamp(24rem,45vw,43rem)]"
      >
        <Mascot
          glow
          faceClassName="fill-[oklch(0.13_0_0)]"
          eyesClassName="fill-primary"
          raysClassName={on ? "fill-primary" : "fill-foreground/20"}
          className="-mb-[20%] block w-full text-foreground"
        />
        <div className="absolute top-[-5%] left-[26%] size-0 md:top-[33%] md:left-[31%]">
          <AnimatePresence>
            {on && (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 14, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97 }}
                transition={{ duration: 0.55, ease }}
                className={cn(
                  "absolute bottom-0 w-max max-w-[min(19rem,66vw)] rounded-2xl max-md:left-0 max-md:origin-bottom-left max-md:rounded-bl-md md:right-0 md:origin-bottom-right md:rounded-br-md",
                  "border border-white/12 bg-card/95 px-4 py-3 shadow-[0_24px_60px_-18px_rgb(0_0_0/0.9)] backdrop-blur-sm",
                )}
              >
                <p className="text-xs text-muted-foreground tabular-nums">{notice.time}</p>
                <p className="mt-1 text-[15px] leading-[1.3] font-semibold text-pretty md:text-base">
                  {notice.what}
                </p>
                <p className="mt-1 text-sm leading-[1.4] text-pretty text-muted-foreground">
                  {notice.why}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </section>
  );
}
