import { useNavigate } from "@tanstack/react-router";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { navMain } from "@/lib/navigation";

export function CommandBar({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();

  function handleSelect(url: string) {
    onOpenChange(false);
    navigate({ to: url });
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      style={{ viewTransitionName: open ? "command-bar" : undefined }}
    >
      <Command>
        <CommandInput placeholder="Search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          {navMain.map((group) => (
            <CommandGroup key={group.title} heading={group.title}>
              {group.items?.map((item) => (
                <CommandItem
                  key={item.url}
                  onSelect={() => handleSelect(item.url)}
                >
                  {group.icon && <group.icon />}
                  {item.title}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
