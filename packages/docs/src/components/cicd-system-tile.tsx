import type { IconType } from "@icons-pack/react-simple-icons";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
  },
};

export interface CICDSystem {
  name: string;
  Icon: IconType;
  status: "beta" | "planned";
}

interface CICDStatusTileProps {
  item: CICDSystem;
  reduceMotion?: boolean;
}

export function CICDSystemTile({ item, reduceMotion }: CICDStatusTileProps) {
  return (
    <motion.div
      variants={fadeUp}
      whileHover={reduceMotion ? undefined : { y: -3, scale: 1.015 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className="cicd-tile flex items-center justify-between"
    >
      <div className="flex items-center gap-2">
        <div className="rounded-md border border-fd-border bg-fd-secondary/30 p-1.5">
          <item.Icon color="default" />
        </div>
        <p className="text-sm font-semibold">{item.name}</p>
      </div>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 font-mono text-[10px]",
          item.status === "beta" &&
            "border border-everr-deep/25 bg-everr/12 text-everr-deep",
          item.status === "planned" &&
            "border border-fd-border bg-fd-secondary/40 text-fd-muted-foreground",
        )}
      >
        {item.status}
      </span>
    </motion.div>
  );
}
