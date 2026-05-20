import { cn } from "@everr/ui/lib/utils";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4 last:mb-0">
      <h2 className="text-muted-foreground mb-2 text-xs font-medium">
        {title}
      </h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

export function DetailItem({
  icon,
  label,
  value,
  mono,
}: {
  icon?: React.ReactNode;
  label: string;
  value?: string;
  mono?: boolean;
}) {
  return (
    <div className="group relative grid min-w-0 grid-cols-[96px_minmax(0,1fr)] gap-3 rounded-md border bg-background/70 px-2.5 py-2 text-xs">
      <span className="text-muted-foreground flex min-w-0 items-center gap-1">
        {icon ? <span className="[&>svg]:size-3">{icon}</span> : null}
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-right",
          mono && "font-mono",
          !value && "text-muted-foreground",
        )}
      >
        {value || "N/A"}
      </span>
      {value ? (
        <CopyValueButton
          value={value}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 bg-background shadow-sm"
        />
      ) : null}
    </div>
  );
}

export function CopyValueButton({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy value"}
      title={copied ? "Copied" : "Copy value"}
      onClick={handleCopy}
      className={cn(
        "text-muted-foreground hover:text-foreground hover:bg-muted-foreground/20 inline-flex size-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none",
        className,
      )}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

export function AttributeMap({
  title,
  map,
}: {
  title: string;
  map: Record<string, string>;
}) {
  const entries = Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;
  return (
    <DetailSection title={title}>
      {entries.map(([key, value]) => (
        <DetailItem key={key} label={key} value={value} mono />
      ))}
    </DetailSection>
  );
}
