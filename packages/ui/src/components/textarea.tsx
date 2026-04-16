import { cn } from "@everr/ui/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-border bg-input/30 hover:bg-input/45 bg-clip-padding outline-2 outline-dotted outline-transparent outline-offset-2 ring-offset-background focus-visible:border-ring focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-offset-[3px] aria-invalid:ring-destructive/40 aria-invalid:ring-2 aria-invalid:border-destructive/50 resize-none rounded-md border px-2 py-2 text-sm transition-[outline,outline-offset,box-shadow,background-color,border-color] duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] md:text-xs/relaxed placeholder:text-muted-foreground flex field-sizing-content min-h-16 w-full disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
