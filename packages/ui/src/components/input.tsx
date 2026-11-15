import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@everr/ui/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      // Read-only drops the fill and the hover: a field that looks editable but
      // refuses typing is a false affordance. It stays focusable, so the value
      // can still be selected and copied.
      className={cn(
        "bg-input/30 hover:bg-input/45 bg-clip-padding border-border outline-2 outline-dotted outline-transparent outline-offset-2 ring-offset-background focus-visible:border-ring focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-offset-[3px] aria-invalid:ring-destructive/40 aria-invalid:ring-2 aria-invalid:border-destructive/50 h-8 rounded-md border px-2 py-0.5 text-base transition-[outline,outline-offset,box-shadow,background-color,border-color] duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] file:h-6 file:text-xs/relaxed file:font-medium md:text-xs/relaxed file:text-foreground placeholder:text-muted-foreground w-full min-w-0 file:inline-flex file:border-0 file:bg-transparent disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 read-only:bg-transparent read-only:hover:bg-transparent read-only:cursor-default",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
