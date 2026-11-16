import type { Replayer as RrwebReplayer } from "@rrweb/replay";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import "@rrweb/replay/dist/style.css";
import type { RecordedEvent } from "#app/data/replay/options.ts";

export type ReplayHandle = {
  /** Moves to `ms` after the first event, playing or paused. */
  seek: (ms: number, play: boolean) => void;
  /** Milliseconds after the first event; undefined until the player exists. */
  getTime: () => number | undefined;
};

/**
 * The rrweb player, scaled to fit its parent. It keeps rrweb's default iframe
 * sandbox, without scripts: the recorded DOM comes from end users' browsers.
 */
export function ReplayStage({
  events,
  initialTime,
  autoplay,
  handleRef,
  onClick,
  onFinish,
}: {
  events: RecordedEvent[];
  /** Read when the player is created. */
  initialTime: number;
  /** Read when the player is created. */
  autoplay: boolean;
  handleRef: Ref<ReplayHandle>;
  /** A click on the picture, which plays or pauses like any video. */
  onClick: () => void;
  onFinish: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<RrwebReplayer | null>(null);
  // The player loads asynchronously, so it starts from the values at that moment.
  const startRef = useRef({ initialTime, autoplay });
  startRef.current = { initialTime, autoplay };
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useImperativeHandle(handleRef, () => ({
    seek(ms, play) {
      const player = playerRef.current;
      if (!player) return;
      if (play) player.play(ms);
      else player.pause(ms);
    },
    getTime() {
      return playerRef.current?.getCurrentTime();
    },
  }));

  useEffect(() => {
    if (!rootRef.current || events.length === 0) return;
    let dead = false;
    let player: RrwebReplayer | undefined;
    let observer: ResizeObserver | undefined;

    void import("@rrweb/replay").then(({ Replayer }) => {
      if (dead || !rootRef.current) return;
      const created = new Replayer(
        // oxlint-disable-next-line typescript/consistent-type-assertions -- rrweb's recorder wrote these events; the wire type does not spell out rrweb's event union.
        events as unknown as ConstructorParameters<typeof Replayer>[0],
        {
          root: rootRef.current,
          mouseTail: false,
          showWarning: false,
          skipInactive: false,
          speed: 1,
        },
      );
      player = created;
      playerRef.current = created;
      const { initialTime: at, autoplay: play } = startRef.current;
      if (play) created.play(at);
      else created.pause(at);
      created.on("finish", () => onFinishRef.current());

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
      const host = rootRef.current.parentElement;
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
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the Play button is the keyboard path; a click on the picture is the pointer shortcut every video player has
    <div
      className="grid h-full w-full cursor-pointer place-items-center overflow-hidden bg-muted"
      onClick={onClick}
    >
      {/* A browser draws a page with no background of its own on white, so the replay does too. */}
      <div ref={rootRef} className="overflow-hidden bg-white shadow-md ring-1 ring-black/10" />
    </div>
  );
}
