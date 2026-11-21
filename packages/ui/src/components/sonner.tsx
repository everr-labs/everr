import { Spinner } from "@everr/ui/components/spinner";
import { CircleCheckIcon, InfoIcon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const style: React.CSSProperties & Record<`--${string}`, string> = {
    "--normal-bg": "var(--popover)",
    "--normal-text": "var(--popover-foreground)",
    "--normal-border": "var(--border)",
    "--border-radius": "var(--radius)",
  };
  return (
    <Sonner
      theme="dark"
      // Otherwise sonner calls `getComputedStyle` for the direction on every
      // render, a full style recalculation. The apps are left-to-right.
      dir="ltr"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Spinner />,
      }}
      style={style}
      toastOptions={{
        classNames: {
          toast: "cn-toast shadow-(--shadow-elevated)! border-transparent!",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
