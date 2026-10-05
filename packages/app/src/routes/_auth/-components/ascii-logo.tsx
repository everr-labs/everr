import { EverrLogoMark } from "@everr/ui/components/everr-logo";
import { everrLogoPaths } from "@everr/ui/components/everr-logo-paths";
import { useEffect, useRef } from "react";

const CHARACTERS = " .,:+=*%#@";
const CELL_WIDTH = 7;
const CELL_HEIGHT = 11;
const FRAME_INTERVAL = 1000 / 30;
const IDLE_GAZES = [
  [0, 0],
  [0.7, -0.2],
  [0.7, 0.3],
  [0, 0],
  [-0.6, -0.35],
  [0, 0],
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function eyelid(time: number, blinkAt: number, duration: number) {
  const progress = (time - blinkAt) / duration;
  if (progress < 0 || progress > 1) return 1;
  return Math.max(0.06, 1 - Math.sin(progress * Math.PI) ** 2);
}

export function AsciiLogo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    const sampleCanvas = document.createElement("canvas");
    const sampleContext = sampleCanvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!context || !sampleContext) return;

    const paths = {
      body: new Path2D(everrLogoPaths.body),
      antenna: new Path2D(everrLogoPaths.antenna),
      rays: new Path2D(everrLogoPaths.rays),
      leftEye: new Path2D(everrLogoPaths.leftEye),
      rightEye: new Path2D(everrLogoPaths.rightEye),
    };
    const styles = getComputedStyle(canvas);
    const foreground = styles.color;
    const primary = styles.getPropertyValue("--primary").trim();
    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    let reducedMotion = motionPreference.matches;
    let intersecting = true;
    let bounds = canvas.getBoundingClientRect();
    let width = 0;
    let height = 0;
    let columns = 0;
    let rows = 0;
    let frame = 0;
    let lastPaint = 0;
    let lastTime = performance.now();
    let elapsed = 0;
    let nextBlink = 2.4;
    let blinkAt = -10;
    let winkAt = -10;
    let pointerAt = -10;
    let clickAt = -10;
    let gazeX = 0;
    let gazeY = 0;
    let pointerX = 0;
    let pointerY = 0;

    function drawEye(path: Path2D, x: number, openness: number) {
      if (!sampleContext) return;
      sampleContext.save();
      sampleContext.translate(x + gazeX * 24, 440 + gazeY * 18);
      sampleContext.scale(1, openness);
      sampleContext.translate(-x, -440);
      sampleContext.fill(path, "evenodd");
      sampleContext.restore();
    }

    function paint(now: number) {
      if (!canvas || !context || !sampleContext || width === 0 || height === 0)
        return;

      const delta = clamp((now - lastTime) / 1000, 0, 0.1);
      lastTime = now;
      if (!reducedMotion) elapsed += delta;
      const time = reducedMotion ? 0 : elapsed;
      if (time >= nextBlink) {
        blinkAt = time;
        nextBlink = time + 3.2 + Math.random() * 3;
      }

      const idleGaze = IDLE_GAZES[Math.floor(time / 3.4) % IDLE_GAZES.length];
      const tracking = !reducedMotion && time - pointerAt < 2.5;
      const targetX = reducedMotion ? 0 : tracking ? pointerX : idleGaze[0];
      const targetY = reducedMotion ? 0 : tracking ? pointerY : idleGaze[1];
      const easing = 1 - Math.exp(-delta * 7);
      gazeX += (targetX - gazeX) * easing;
      gazeY += (targetY - gazeY) * easing;

      const reaction = reducedMotion
        ? 0
        : Math.sin(clamp((time - clickAt) / 0.8, 0, 1) * Math.PI);
      const bob = reducedMotion ? 0 : Math.sin(time * 1.5) * 5 - reaction * 10;
      const tilt = reducedMotion
        ? 0
        : Math.sin(time * 0.7) * 0.012 + gazeX * 0.025 + reaction * 0.045;
      const size = Math.min(width * 0.72, height * 0.57, 640);

      sampleContext.resetTransform();
      sampleContext.clearRect(0, 0, sampleCanvas.width, sampleCanvas.height);
      sampleContext.scale(2 / CELL_WIDTH, 2 / CELL_HEIGHT);
      sampleContext.translate(width * 0.5, height * 0.49 + bob);
      sampleContext.rotate(tilt);
      sampleContext.scale(size / 657, size / 657);
      sampleContext.translate(-328.5, -328.5);
      sampleContext.fillStyle = foreground;
      sampleContext.fill(paths.body, "evenodd");
      sampleContext.fill(paths.antenna, "evenodd");
      sampleContext.fillStyle = primary;
      sampleContext.fill(paths.rays, "evenodd");
      const blink = reducedMotion ? 1 : eyelid(time, blinkAt, 0.24);
      drawEye(
        paths.leftEye,
        280,
        Math.min(blink, reducedMotion ? 1 : eyelid(time, winkAt, 0.38)),
      );
      drawEye(paths.rightEye, 444, blink);

      const pixels = sampleContext.getImageData(
        0,
        0,
        sampleCanvas.width,
        sampleCanvas.height,
      ).data;
      context.fillStyle = "#000";
      context.fillRect(0, 0, width, height);
      context.font = '10px "Menlo", "Consolas", monospace';
      context.textAlign = "center";
      context.textBaseline = "middle";

      context.fillStyle = foreground;
      context.globalAlpha = 0.1;
      for (let i = 0; i < 45; i++) {
        const x = ((i * 137.3) % width) + 0.5;
        const y = (i * 97.7) % height;
        context.fillText(".", x, y);
      }

      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          let coverage = 0;
          let green = 0;
          let blue = 0;
          for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 2; x++) {
              const index =
                ((row * 2 + y) * sampleCanvas.width + column * 2 + x) * 4;
              const alpha = pixels[index + 3] / 255;
              coverage += alpha / 4;
              green += pixels[index + 1] * alpha;
              blue += pixels[index + 2] * alpha;
            }
          }
          if (coverage < 0.06) continue;
          const accent = green > blue * 1.5;
          const shading = 0.78 + (column / columns) * 0.12;
          const character = Math.max(
            1,
            Math.floor(coverage * shading * (CHARACTERS.length - 1)),
          );
          context.fillStyle = accent ? primary : foreground;
          context.globalAlpha = 0.35 + coverage * 0.6;
          context.fillText(
            CHARACTERS[character],
            (column + 0.5) * CELL_WIDTH,
            (row + 0.5) * CELL_HEIGHT,
          );
        }
      }
      context.globalAlpha = 1;
    }

    function animate(now: number) {
      if (now - lastPaint >= FRAME_INTERVAL) {
        paint(now);
        lastPaint = now;
      }
      frame = requestAnimationFrame(animate);
    }

    function restart() {
      cancelAnimationFrame(frame);
      if (!intersecting || document.hidden || width === 0 || height === 0)
        return;
      lastTime = performance.now();
      paint(lastTime);
      if (!reducedMotion) frame = requestAnimationFrame(animate);
    }

    function resize() {
      if (!canvas || !context) return;
      bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      columns = Math.ceil(width / CELL_WIDTH);
      rows = Math.ceil(height / CELL_HEIGHT);
      sampleCanvas.width = columns * 2;
      sampleCanvas.height = rows * 2;
      restart();
    }

    const onPointerMove = (event: PointerEvent) => {
      if (reducedMotion || width === 0 || height === 0) return;
      pointerX = clamp(
        ((event.clientX - bounds.left) / width - 0.5) * 2,
        -1,
        1,
      );
      pointerY = clamp(
        ((event.clientY - bounds.top) / height - 0.5) * 2,
        -1,
        1,
      );
      pointerAt = elapsed;
    };
    const onPointerLeave = () => {
      pointerAt = -10;
    };
    const onClick = () => {
      if (reducedMotion) return;
      winkAt = elapsed;
      clickAt = elapsed;
    };
    const onMotionChange = () => {
      reducedMotion = motionPreference.matches;
      gazeX = 0;
      gazeY = 0;
      restart();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      restart();
    });
    intersectionObserver.observe(canvas);
    window.addEventListener("pointermove", onPointerMove);
    document.documentElement.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("pointerdown", onClick);
    document.addEventListener("visibilitychange", restart);
    motionPreference.addEventListener("change", onMotionChange);
    resize();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      document.documentElement.removeEventListener(
        "pointerleave",
        onPointerLeave,
      );
      canvas.removeEventListener("pointerdown", onClick);
      document.removeEventListener("visibilitychange", restart);
      motionPreference.removeEventListener("change", onMotionChange);
    };
  }, []);

  return (
    <div className="absolute inset-0 text-foreground" aria-hidden="true">
      <EverrLogoMark className="absolute top-[49%] left-1/2 w-[72%] max-w-[640px] -translate-x-1/2 -translate-y-1/2" />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
