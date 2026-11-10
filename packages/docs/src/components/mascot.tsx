import { everrLogoPaths } from "@everr/ui/components/everr-logo-paths";
import { cn } from "@everr/ui/lib/utils";
import { type ComponentProps, useEffect, useRef } from "react";

type MascotProps = ComponentProps<"svg"> & {
  /** Fills the face, which is otherwise a hole in the body */
  faceClassName?: string;
  eyesClassName?: string;
  raysClassName?: string;
  /** The eyes give off light */
  glow?: boolean;
  /** How far the eyes travel toward the pointer, in the logo's own units (it is 657 wide) */
  reach?: number;
};

/** The Everr mark, looking at the pointer. One color unless the parts are styled. */
export function Mascot({
  faceClassName,
  eyesClassName,
  raysClassName,
  glow = false,
  reach = 16,
  ...props
}: MascotProps) {
  const svg = useRef<SVGSVGElement>(null);
  const eyes = useRef<SVGGElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const look = (e: PointerEvent) => {
      const box = svg.current?.getBoundingClientRect();
      if (!box || !eyes.current) return;
      const dx = e.clientX - (box.left + box.width * 0.55);
      const dy = e.clientY - (box.top + box.height * 0.67);
      // Eases toward the limit, so the eyes keep moving a little however far the pointer is
      const pull = Math.tanh(Math.hypot(dx, dy) / 400) * reach;
      const angle = Math.atan2(dy, dx);
      eyes.current.style.transform = `translate(${Math.cos(angle) * pull}px, ${Math.sin(angle) * pull}px)`;
    };
    window.addEventListener("pointermove", look, { passive: true });
    return () => window.removeEventListener("pointermove", look);
  }, [reach]);

  const eyePaths = everrLogoPaths.rightEye + everrLogoPaths.leftEye;
  const blink =
    "[transform-box:fill-box] origin-center motion-safe:animate-[mascot-blink_5.5s_infinite]";

  return (
    <svg
      ref={svg}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 657 657"
      fill="currentColor"
      clipRule="evenodd"
      aria-hidden="true"
      {...props}
    >
      {/* The same outline without its hole, under the body: only the face shows through */}
      {faceClassName && (
        <path fillRule="nonzero" className={faceClassName} d={everrLogoPaths.body} />
      )}
      <path fillRule="evenodd" d={everrLogoPaths.body} />
      <path fillRule="evenodd" d={everrLogoPaths.antenna} />
      <path
        fillRule="evenodd"
        className={cn("transition-[fill] duration-500", raysClassName)}
        d={everrLogoPaths.rays}
      />
      <g ref={eyes} className={cn("transition-transform duration-200 ease-out", eyesClassName)}>
        {glow && <path className={cn(blink, "opacity-70 blur-[22px]")} d={eyePaths} />}
        <path className={blink} d={eyePaths} />
      </g>
    </svg>
  );
}
