import { cn } from "@everr/ui/lib/utils";
import { Pause, Play } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Playhead } from "@/components/monitoring-demo/kit";

// A demo told in chapters, with its player: pause, the chapters as colored
// segments to jump between, a bar at the play position with the chapter's
// name in a flag. The demo plays from `jump` and reports each chapter it
// starts through `onChapter`.

export type PlayerChapter<C extends number> = {
  chapter: C;
  label: string;
  /** One color per chapter; neighbours differ in lightness as well as hue */
  color: string;
  /** How long the chapter plays */
  ms: number;
};

const clockTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

type Side = "top" | "bottom";

// The timeline's elements and geometry, drawn imperatively: geometry is
// measured on resize, and a frame only writes transforms and text, so it
// never forces a layout.
class TimelineView {
  segments: (HTMLButtonElement | null)[] = [];
  fills: (HTMLSpanElement | null)[] = [];
  track: HTMLDivElement | null = null;
  head: HTMLSpanElement | null = null;
  flag: HTMLSpanElement | null = null;
  hoverFlag: HTMLSpanElement | null = null;
  time: HTMLSpanElement | null = null;
  hoverX: number | null = null;
  geo: { segs: { left: number; width: number }[]; track: number; flag: number; hover: number } = {
    segs: [],
    track: 0,
    flag: 0,
    hover: 0,
  };

  private total: number;

  constructor(
    private ms: readonly number[],
    private playhead: Playhead,
    private chapter: RefObject<number>,
    private startedAt: RefObject<number>,
  ) {
    this.total = ms.reduce((sum, m) => sum + m, 0);
  }

  measure() {
    this.geo = {
      segs: this.segments.map((el) => ({ left: el?.offsetLeft ?? 0, width: el?.offsetWidth ?? 0 })),
      track: this.track?.offsetWidth ?? 0,
      flag: this.flag?.offsetWidth ?? 0,
      hover: this.hoverFlag?.offsetWidth ?? 0,
    };
    this.draw();
  }

  draw() {
    const g = this.geo;
    const c = this.chapter.current;
    const into = Math.min(this.ms[c], Math.max(0, this.playhead.now() - this.startedAt.current));
    const p = into / this.ms[c];
    const seg = g.segs[c];
    const x = seg ? seg.left + p * seg.width : 0;
    const clamp = (at: number, w: number) =>
      Math.min(Math.max(0, at - w / 2), Math.max(0, g.track - w));
    this.fills.forEach((el, i) => {
      if (el) el.style.transform = `scaleX(${i < c ? 1 : i === c ? p : 0})`;
    });
    if (this.head) this.head.style.transform = `translateX(${x}px)`;
    if (this.flag) this.flag.style.transform = `translateX(${clamp(x, g.flag)}px)`;
    if (this.hoverFlag && this.hoverX !== null)
      this.hoverFlag.style.transform = `translateX(${clamp(this.hoverX, g.hover)}px)`;
    const before = this.ms.slice(0, c).reduce((sum, ms) => sum + ms, 0);
    const text = `${clockTime(before + into)} / ${clockTime(this.total)}`;
    if (this.time && this.time.textContent !== text) this.time.textContent = text;
  }
}

// Pause, the chapters as colored segments, a bar at the play position with the
// chapter's name in a flag, and the time played. Hovering a segment previews
// its name in a flag at the pointer. The fills, bar, flag positions and time
// are written from the playhead outside React, as transforms, from geometry
// measured on resize.
function Timeline<C extends number>({
  chapters,
  playhead,
  chapter,
  startedAt,
  current,
  paused,
  side,
  onToggle,
  onJump,
}: {
  chapters: readonly PlayerChapter<C>[];
  playhead: Playhead;
  chapter: RefObject<C>;
  startedAt: RefObject<number>;
  current: C;
  paused: boolean;
  side: Side;
  onToggle: () => void;
  onJump: (chapter: C) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [view] = useState(
    () =>
      new TimelineView(
        chapters.map((c) => c.ms),
        playhead,
        chapter,
        startedAt,
      ),
  );
  const [hover, setHover] = useState<C | null>(null);
  const [visible, setVisible] = useState(false);

  // Measure now and whenever the track or a flag resizes (a flag resizes when
  // its label changes), then redraw at the new geometry
  useEffect(() => {
    view.measure();
    const ro = new ResizeObserver(() => view.measure());
    for (const el of [view.track, view.flag, view.hoverFlag]) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Run frames only while the player is on screen and playing. Paused or
  // jumped, one frame brings it up to date.
  useEffect(() => {
    view.draw();
    if (!visible || paused) return;
    let id = 0;
    const tick = () => {
      view.draw();
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [view, visible, paused, current]);

  const color = chapters[current].color;
  return (
    <div
      ref={root}
      className={cn(
        "flex h-11 items-center gap-3 border border-border bg-card px-2.5",
        side === "top" ? "rounded-t-xl border-b-0" : "rounded-b-xl border-t-0",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={paused ? "Play demo" : "Pause demo"}
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&>svg]:size-3.5 [&>svg]:fill-current"
      >
        {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
      </button>
      <div
        ref={(el) => {
          view.track = el;
        }}
        className="relative flex min-w-0 flex-1 gap-1"
        onPointerMove={(e) => {
          const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
          view.hoverX = x;
          const i = view.geo.segs.findIndex((s) => x < s.left + s.width);
          const next = chapters[i === -1 ? chapters.length - 1 : i].chapter;
          if (next !== hover) setHover(next);
          // The frame loop may be stopped (paused, or between frames): place the preview now
          view.draw();
        }}
        onPointerLeave={() => {
          view.hoverX = null;
          setHover(null);
        }}
      >
        {chapters.map(({ chapter, label, color }, i) => (
          <button
            key={chapter}
            ref={(el) => {
              view.segments[i] = el;
            }}
            type="button"
            onClick={() => onJump(chapter)}
            aria-label={`Play: ${label}`}
            style={{ flexGrow: chapters[i].ms }}
            className="group h-5 basis-0 cursor-pointer"
          >
            <span className="block h-[3px] overflow-hidden rounded-full bg-muted transition-[height,background-color] duration-150 group-hover:h-[7px] group-hover:bg-white/35">
              <span
                ref={(el) => {
                  view.fills[i] = el;
                }}
                style={{ backgroundColor: color, transform: "scaleX(0)" }}
                className="block h-full origin-left"
              />
            </span>
          </button>
        ))}
        <span
          ref={(el) => {
            view.head = el;
          }}
          style={{ backgroundColor: color }}
          className="pointer-events-none absolute top-1/2 left-0 h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
        />
        <span
          ref={(el) => {
            view.flag = el;
          }}
          aria-live="polite"
          style={{ backgroundColor: color }}
          className={cn(
            "pointer-events-none absolute left-0 rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider whitespace-nowrap text-black uppercase transition-opacity duration-150",
            side === "top" ? "bottom-full mb-4" : "top-full mt-4",
            hover !== null && hover !== current && "opacity-0",
          )}
        >
          {chapters[current].label}
        </span>
        {/* The preview: which chapter a click on the segment under the pointer plays */}
        <span
          ref={(el) => {
            view.hoverFlag = el;
          }}
          aria-hidden="true"
          style={{ backgroundColor: hover === null ? undefined : chapters[hover].color }}
          className={cn(
            "pointer-events-none absolute left-0 rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wider whitespace-nowrap text-black uppercase transition-opacity duration-150",
            side === "top" ? "bottom-full mb-4" : "top-full mt-4",
            hover === null || hover === current ? "opacity-0" : "opacity-100",
          )}
        >
          {hover === null ? "" : chapters[hover].label}
        </span>
      </div>
      <span
        ref={(el) => {
          view.time = el;
        }}
        className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
      >
        {`0:00 / ${clockTime(chapters.reduce((sum, c) => sum + c.ms, 0))}`}
      </span>
    </div>
  );
}

// The controls sit above the demo, and move below it once its top has
// scrolled under the site header.
const HEADER_PX = 56;
const SIDES: Side[] = ["top", "bottom"];
// The controls tuck into the card's edge: down behind it at the top, up behind
// it below. Far enough to clear the clip, flag included.
const SLIDE: Record<Side, number> = { top: 90, bottom: -90 };

export function DemoPlayer<C extends number>({
  chapters,
  children,
}: {
  chapters: readonly PlayerChapter<C>[];
  children: (props: {
    jump: { chapter: C };
    playhead: Playhead;
    onChapter: (chapter: C, startedAt: number) => void;
  }) => ReactNode;
}) {
  const first = chapters[0].chapter;
  const [playhead] = useState(() => new Playhead());
  const [screen, setScreen] = useState<C>(first);
  const [jump, setJump] = useState<{ chapter: C }>({ chapter: first });
  const [paused, setPaused] = useState(false);
  const [side, setSide] = useState<Side>("top");
  const chapter = useRef<C>(first);
  const startedAt = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) =>
        setSide(
          !entry.isIntersecting && entry.boundingClientRect.top < HEADER_PX ? "bottom" : "top",
        ),
      { rootMargin: `-${HEADER_PX}px 0px 0px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onChapter = useCallback((c: C, at: number) => {
    chapter.current = c;
    startedAt.current = at;
    setScreen(c);
  }, []);
  const go = (c: C) => {
    playhead.setPaused(false);
    setPaused(false);
    onChapter(c, playhead.now());
    setJump({ chapter: c });
  };
  const toggle = () => {
    playhead.setPaused(!paused);
    setPaused(!paused);
  };

  return (
    <div className="relative pt-11 motion-reduce:pt-0">
      <div ref={sentinel} className="absolute inset-x-0 top-11 h-px" />
      {/* One clip per side, with room for the flag: the controls slide out of
          one and into the other instead of fading */}
      {SIDES.map((at) => (
        <div
          key={at}
          className={cn(
            "pointer-events-none absolute inset-x-0 z-10 overflow-hidden motion-reduce:hidden",
            at === "top" ? "-top-10 pt-10" : "top-full pb-10",
          )}
        >
          <AnimatePresence initial={false}>
            {side === at && (
              <motion.div
                initial={{ y: SLIDE[at] }}
                animate={{ y: 0 }}
                exit={{ y: SLIDE[at] }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-auto"
              >
                <Timeline
                  chapters={chapters}
                  playhead={playhead}
                  chapter={chapter}
                  startedAt={startedAt}
                  current={screen}
                  paused={paused}
                  side={side}
                  onToggle={toggle}
                  onJump={go}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
      {/* The controls are the card's top or bottom edge, so that corner squares off */}
      <figure
        className="min-w-0 overflow-hidden rounded-xl border border-border bg-card transition-[border-radius] duration-300 motion-safe:data-[side=bottom]:rounded-b-none motion-safe:data-[side=top]:rounded-t-none"
        data-side={side}
      >
        {children({ jump, playhead, onChapter })}
      </figure>
    </div>
  );
}
