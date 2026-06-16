import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@everr/ui/lib/utils";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "border-border bg-input/30 hover:bg-input/45 data-[checked]:bg-primary data-[checked]:hover:bg-primary/90 outline-2 outline-dotted outline-transparent outline-offset-2 ring-offset-background focus-visible:border-ring focus-visible:ring-primary focus-visible:ring-2 focus-visible:ring-offset-[3px] inline-flex h-4.5 w-8 shrink-0 items-center rounded-full border transition-[outline,outline-offset,box-shadow,background-color,border-color] duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="bg-foreground data-[checked]:bg-primary-foreground pointer-events-none block size-3.5 translate-x-0.5 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.19,1,0.22,1)] data-[checked]:translate-x-[15px]"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
