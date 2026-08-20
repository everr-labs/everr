import { Button } from "@everr/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@everr/ui/components/dropdown-menu";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopyIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

const meta = {
  title: "Overlays/DropdownMenu",
  component: DropdownMenu,
} satisfies Meta<typeof DropdownMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <div className="flex min-h-80 items-start justify-center pt-4">
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          Actions
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Rule</DropdownMenuLabel>
            <DropdownMenuItem>
              <PencilIcon />
              Edit
              <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <CopyIcon />
              Copy YAML
              <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>Adopt rule</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLinkItem href="https://example.com/docs">
            Open the docs
          </DropdownMenuLinkItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">
            <Trash2Icon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
};

export const WithSubmenu: Story = {
  render: () => (
    <div className="flex min-h-80 items-start justify-center pt-4">
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          Export
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuItem>Export now</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Export as</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>CSV</DropdownMenuItem>
              <DropdownMenuItem>JSON</DropdownMenuItem>
              <DropdownMenuItem>Parquet</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
};

export const WithCheckboxItems: Story = {
  render: function WithCheckboxItemsStory() {
    const [columns, setColumns] = useState({
      service: true,
      severity: true,
      duration: false,
    });

    return (
      <div className="flex min-h-80 items-start justify-center pt-4">
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger render={<Button variant="outline" />}>
            Columns
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(["service", "severity", "duration"] as const).map((column) => (
                <DropdownMenuCheckboxItem
                  key={column}
                  checked={columns[column]}
                  closeOnClick={false}
                  onCheckedChange={(checked) =>
                    setColumns((current) => ({ ...current, [column]: checked }))
                  }
                >
                  {column}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  },
};

export const WithRadioItems: Story = {
  render: function WithRadioItemsStory() {
    const [range, setRange] = useState("1h");

    return (
      <div className="flex min-h-80 items-start justify-center pt-4">
        <DropdownMenu defaultOpen>
          <DropdownMenuTrigger render={<Button variant="outline" />}>
            Last {range}
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Time range</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={range}
              onValueChange={(value) => setRange(String(value))}
            >
              <DropdownMenuRadioItem value="15m">15m</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="1h">1h</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="24h">24h</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  },
};

export const InsetItems: Story = {
  render: () => (
    <div className="flex min-h-80 items-start justify-center pt-4">
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger render={<Button variant="outline" />}>
          View
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel inset>Layout</DropdownMenuLabel>
            <DropdownMenuItem inset>Compact</DropdownMenuItem>
            <DropdownMenuItem inset>Comfortable</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ),
};
