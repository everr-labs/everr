import { Button } from "@everr/ui/components/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@everr/ui/components/command";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { BellIcon, GaugeIcon, SearchIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";

const meta = {
  title: "Overlays/Command",
  component: Command,
} satisfies Meta<typeof Command>;

export default meta;
type Story = StoryObj<typeof meta>;

function CommandBody() {
  return (
    <>
      <CommandInput placeholder="Search for a command..." />
      <CommandList>
        <CommandEmpty>No command matches that search.</CommandEmpty>
        <CommandGroup heading="Navigate">
          <CommandItem>
            <GaugeIcon />
            Dashboards
            <CommandShortcut>⌘D</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <BellIcon />
            Alerts
            <CommandShortcut>⌘A</CommandShortcut>
          </CommandItem>
          <CommandItem>
            <SearchIcon />
            Traces
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem>
            <SettingsIcon />
            Organization settings
          </CommandItem>
          <CommandItem disabled>Billing</CommandItem>
        </CommandGroup>
      </CommandList>
    </>
  );
}

export const Inline: Story = {
  render: () => (
    <div className="ring-foreground/10 mx-auto max-w-md rounded-xl ring-1">
      <Command>
        <CommandBody />
      </Command>
    </div>
  ),
};

export const Empty: Story = {
  render: () => (
    <div className="ring-foreground/10 mx-auto max-w-md rounded-xl ring-1">
      <Command>
        <CommandInput
          placeholder="Search for a command..."
          value="unknown command"
          onValueChange={() => {}}
        />
        <CommandList>
          <CommandEmpty>No command matches that search.</CommandEmpty>
          <CommandGroup heading="Navigate">
            <CommandItem>Dashboards</CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </div>
  ),
};

export const AsDialog: Story = {
  render: function AsDialogStory() {
    const [open, setOpen] = useState(true);

    return (
      <>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Open command palette
        </Button>
        <CommandDialog open={open} onOpenChange={setOpen}>
          <Command>
            <CommandBody />
          </Command>
        </CommandDialog>
      </>
    );
  },
};

export const AsDialogWithCloseButton: Story = {
  render: function AsDialogWithCloseButtonStory() {
    const [open, setOpen] = useState(true);

    return (
      <>
        <Button variant="outline" onClick={() => setOpen(true)}>
          Open command palette
        </Button>
        <CommandDialog
          open={open}
          onOpenChange={setOpen}
          showCloseButton
          title="Jump to"
          description="Type the name of a page or an action."
        >
          <Command>
            <CommandBody />
          </Command>
        </CommandDialog>
      </>
    );
  },
};
