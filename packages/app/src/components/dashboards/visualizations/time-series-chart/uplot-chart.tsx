import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export type UplotOptions = Omit<uPlot.Options, "width" | "height">;

export interface UplotChartProps {
  options: UplotOptions;
  /**
   * Recreating a uPlot instance throws away its canvas, so option identity
   * alone must NOT trigger it: the options object is rebuilt on every render
   * (it closes over the current series), while only a change to this key —
   * the series line-up, the spec, the time range — is worth a rebuild. Every
   * other update goes through `setData`, which is the whole point of uPlot.
   */
  optionsKey: string;
  data: uPlot.AlignedData;
  className?: string;
}

export function UplotChart({
  options,
  optionsKey,
  data,
  className,
}: UplotChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const optionsRef = useRef(options);
  const dataRef = useRef(data);
  // The instance is built inside an effect, so it must read whatever the last
  // render produced rather than what the effect's own closure captured.
  optionsRef.current = options;
  dataRef.current = data;
  const appliedRef = useRef<uPlot.AlignedData | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const plot = new uPlot(
      {
        ...optionsRef.current,
        width: Math.max(1, host.clientWidth),
        height: Math.max(1, host.clientHeight),
      },
      dataRef.current,
      host,
    );
    plotRef.current = plot;
    appliedRef.current = dataRef.current;

    const observer = new ResizeObserver(() => {
      plot.setSize({
        width: Math.max(1, host.clientWidth),
        height: Math.max(1, host.clientHeight),
      });
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      plot.destroy();
      plotRef.current = null;
      appliedRef.current = null;
    };
  }, [optionsKey]);

  useEffect(() => {
    // The creation effect already drew this frame; setting it again would
    // rescale and repaint for nothing.
    if (appliedRef.current === data) return;
    appliedRef.current = data;
    plotRef.current?.setData(data);
  }, [data]);

  return <div ref={hostRef} className={className} />;
}
