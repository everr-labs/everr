import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import "@rrweb/replay/dist/style.css";

export type ReplayEvent = {
  type: number;
  timestamp: number;
  data?: unknown;
};

export type ReplayHandle = {
  seek: (ms: number, resume: boolean) => void;
  getTime: () => number;
};

type ReplayerLike = {
  wrapper: HTMLElement;
  iframe: HTMLIFrameElement;
  pause: (timeOffset?: number) => void;
  play: (timeOffset?: number) => void;
  destroy: () => void;
  getCurrentTime: () => number;
  on: (event: string, handler: () => void) => void;
};

export function ReplayStage({
  handleRef,
  events,
  initialTime,
  onEnded,
}: {
  handleRef: Ref<ReplayHandle>;
  events: ReplayEvent[];
  initialTime: number;
  onEnded: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ReplayerLike | null>(null);
  const initialTimeRef = useRef(initialTime);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  useImperativeHandle(handleRef, () => ({
    seek(ms: number, resume: boolean) {
      const player = playerRef.current;
      if (!player) return;
      if (resume) player.play(ms);
      else player.pause(ms);
    },
    getTime() {
      return playerRef.current?.getCurrentTime() ?? 0;
    },
  }));

  useEffect(() => {
    const root = rootRef.current;
    if (!root || events.length === 0) return;
    let dead = false;
    let player: ReplayerLike | undefined;
    let observer: ResizeObserver | undefined;

    void import("@rrweb/replay").then(({ Replayer }) => {
      if (dead || !rootRef.current) return;
      const created = new Replayer(
        events as ConstructorParameters<typeof Replayer>[0],
        {
          root: rootRef.current,
          mouseTail: false,
          showWarning: false,
          skipInactive: false,
          speed: 1,
        },
      ) as ReplayerLike;
      player = created;
      playerRef.current = created;
      created.pause(initialTimeRef.current);
      created.on("finish", () => onEndedRef.current());

      const fit = () => {
        const frame = created.iframe;
        const parent = rootRef.current?.parentElement;
        if (!parent || !frame.offsetWidth || !frame.offsetHeight) return;
        const scale = Math.min(
          parent.clientWidth / frame.offsetWidth,
          parent.clientHeight / frame.offsetHeight,
        );
        created.wrapper.style.transform = `scale(${scale})`;
        created.wrapper.style.transformOrigin = "top left";
        if (rootRef.current) {
          rootRef.current.style.width = `${frame.offsetWidth * scale}px`;
          rootRef.current.style.height = `${frame.offsetHeight * scale}px`;
        }
      };
      created.on("fullsnapshot-rebuilded", fit);
      requestAnimationFrame(fit);
      const host = rootRef.current?.parentElement;
      if (host && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(fit);
        observer.observe(host);
      }
    });

    return () => {
      dead = true;
      observer?.disconnect();
      player?.destroy();
      playerRef.current = null;
    };
  }, [events]);

  return (
    <div className="grid h-full w-full place-items-center overflow-hidden bg-muted">
      <div ref={rootRef} />
    </div>
  );
}
