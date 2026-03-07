import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

function Input({ className, type = "text", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        "flex h-11 w-full min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white outline-none transition-colors placeholder:text-white/38 focus-visible:border-white/20 focus-visible:ring-2 focus-visible:ring-white/12 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
