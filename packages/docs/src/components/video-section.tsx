import { motion, useInView } from "motion/react";
import { useEffect, useRef } from "react";

export function VideoSection() {
  const ref = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const inView = useInView(ref, { margin: "-20% 0px" });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (inView) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [inView]);

  return (
    <section
      ref={ref}
      className="relative overflow-hidden border-b-2 border-fd-border bg-fd-background"
    >
      <div className="mx-auto max-w-7xl px-6 py-24 md:py-36">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={inView ? { opacity: 1, y: 0 } : undefined}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden rounded-xl border-2 border-fd-border shadow-2xl"
        >
          <video
            ref={videoRef}
            className="aspect-video h-auto w-full object-cover"
            src="/demo.mp4"
            muted
            loop
            playsInline
            preload="metadata"
          />
        </motion.div>
      </div>
    </section>
  );
}
