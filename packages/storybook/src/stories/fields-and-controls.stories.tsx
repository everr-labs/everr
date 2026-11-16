import { Button } from "@everr/ui/components/button";
import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import { FilterSearchBar } from "@everr/ui/components/filter-search-bar";
import { Input } from "@everr/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@everr/ui/components/input-group";
import { Label } from "@everr/ui/components/label";
import { OptionCombobox, type OptionComboboxItem } from "@everr/ui/components/option-combobox";
import { RefreshPicker } from "@everr/ui/components/refresh-picker";
import { SecretInput } from "@everr/ui/components/secret-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@everr/ui/components/select";
import { SuggestCombobox } from "@everr/ui/components/suggest-combobox";
import { Switch } from "@everr/ui/components/switch";
import { TagsInput } from "@everr/ui/components/tags-input";
import { Textarea } from "@everr/ui/components/textarea";
import {
  DEFAULT_TIME_RANGE,
  type TimeRange,
  TimeRangePicker,
} from "@everr/ui/components/time-range-picker";
import { ToggleGroup, ToggleGroupItem } from "@everr/ui/components/toggle-group";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { MailIcon, PlusIcon, SearchIcon, WebhookIcon } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

const services = ["checkout-api", "payments-worker", "search-indexer", "edge-gateway"];

const serviceOptions = (key: string) => ({
  queryKey: ["stories", "fields-and-controls", key],
  queryFn: async () => services,
  select: (data: string[]) => data,
});

const suggestOptions = {
  queryKey: ["stories", "fields-and-controls", "suggest"],
  queryFn: async () => services,
  select: (data: string[]) => data.map((value) => ({ value })),
};

const channelTypes: OptionComboboxItem[] = [
  { value: "webhook", label: "Webhook", icon: WebhookIcon },
  { value: "email", label: "Email", icon: MailIcon },
];

const ServiceFilter = FilterCombobox<string[]>;

function StatefulFilter({
  initial = [],
  label,
  placeholder,
  queryKey,
}: {
  initial?: string[];
  label: string;
  placeholder: string;
  queryKey: string;
}) {
  const [values, setValues] = useState(initial);
  return (
    <ServiceFilter
      label={label}
      placeholder={placeholder}
      className="w-full"
      values={values}
      onChange={setValues}
      options={serviceOptions(queryKey)}
    />
  );
}

function StatefulOption({ initial }: { initial: string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <OptionCombobox
      label="Channel type"
      placeholder="Pick a channel type"
      options={channelTypes}
      value={value}
      onChange={setValue}
    />
  );
}

function StatefulSuggest({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <SuggestCombobox
      label="Service"
      placeholder="Any service"
      value={value}
      onChange={setValue}
      options={suggestOptions}
    />
  );
}

function StatefulSearch({ initial }: { initial: string }) {
  const [value, setValue] = useState(initial);
  return (
    <FilterSearchBar
      id={`search-${initial || "empty"}`}
      label="Search"
      placeholder="Filter by span name"
      value={value}
      onChange={setValue}
    />
  );
}

function StatefulTags({ initial }: { initial: string[] }) {
  const [value, setValue] = useState(initial);
  return <TagsInput value={value} onValueChange={setValue} placeholder="Add a recipient" />;
}

function StatefulSecret({ stored }: { stored: boolean }) {
  const [value, setValue] = useState("");
  return (
    <SecretInput
      hasStoredSecret={stored}
      value={value}
      onValueChange={setValue}
      placeholder="Signing secret"
    />
  );
}

function StatefulTimeRange() {
  const [range, setRange] = useState<TimeRange>(DEFAULT_TIME_RANGE);
  return <TimeRangePicker value={range} onChange={setRange} />;
}

function StatefulRefresh() {
  const [interval, setInterval] = useState("off");
  return (
    <RefreshPicker
      value={interval}
      onChange={setInterval}
      onRefresh={() => {}}
      isFetching={false}
    />
  );
}

function StatusToggle() {
  const [status, setStatus] = useState("all");
  return (
    <ToggleGroup
      value={[status]}
      variant="outline"
      size="lg"
      spacing={0}
      className="w-full"
      onValueChange={(next) => next[0] && setStatus(next[0])}
      aria-label="Status"
    >
      <ToggleGroupItem value="all" className="flex-1">
        All
      </ToggleGroupItem>
      <ToggleGroupItem value="ok" className="flex-1">
        OK
      </ToggleGroupItem>
      <ToggleGroupItem value="error" className="flex-1">
        Error
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

function SeveritySelect({ disabled }: { disabled?: boolean }) {
  return (
    <Select defaultValue="page" disabled={disabled}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="page">Page</SelectItem>
        <SelectItem value="ticket">Ticket</SelectItem>
      </SelectContent>
    </Select>
  );
}

/**
 * The computed surface of the first bordered element inside the cell: what
 * actually differs between controls, read from the browser instead of the
 * class lists.
 */
function Surface({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [surface, setSurface] = useState<string[]>([]);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const target = [root, ...root.querySelectorAll<HTMLElement>("*")].slice(1).find((el) => {
      const style = getComputedStyle(el);
      return style.borderTopWidth !== "0px" && el.getBoundingClientRect().height >= 24;
    });
    if (!target) return;
    const style = getComputedStyle(target);
    setSurface([
      `fill ${alpha(style.backgroundColor)}`,
      `border ${alpha(style.borderTopColor)}`,
      `shadow ${shadowLayers(style.boxShadow)}`,
      `${Math.round(target.getBoundingClientRect().height)}px · ${textSize(target)}`,
    ]);
  }, []);

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={ref}>{children}</div>
      <code className="text-muted-foreground font-mono text-[0.625rem] leading-tight">
        {surface.join(" · ")}
      </code>
    </div>
  );
}

/** "oklch(1 0 0 / 0.075)" → "7.5%". Colours without an alpha read as "solid". */
function alpha(color: string): string {
  if (color === "rgba(0, 0, 0, 0)") return "none";
  const match = color.match(/\/\s*([\d.]+)\)$/) ?? color.match(/rgba\([^)]*,\s*([\d.]+)\)$/);
  return match ? `${+(Number(match[1]) * 100).toFixed(1)}%` : "solid";
}

type Row = {
  name: string;
  kind: "type" | "pick" | "action";
  empty: ReactNode;
  filled: ReactNode;
  disabled?: ReactNode;
};

const rows: Row[] = [
  {
    name: "Input",
    kind: "type",
    empty: <Input placeholder="service.name" />,
    filled: <Input defaultValue="checkout-api" />,
    disabled: <Input disabled defaultValue="checkout-api" />,
  },
  {
    name: "Input (read-only)",
    kind: "type",
    empty: <Input readOnly placeholder="Nothing yet" />,
    filled: <Input readOnly defaultValue="ek_live_4f8a…" />,
  },
  {
    name: "InputGroup",
    kind: "type",
    empty: (
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput placeholder="Filter by span name" />
      </InputGroup>
    ),
    filled: (
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput defaultValue="checkout" />
      </InputGroup>
    ),
    disabled: (
      <InputGroup data-disabled="true">
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput disabled defaultValue="checkout" />
      </InputGroup>
    ),
  },
  {
    name: "FilterSearchBar",
    kind: "type",
    empty: <StatefulSearch initial="" />,
    filled: <StatefulSearch initial="checkout" />,
  },
  {
    name: "TagsInput",
    kind: "type",
    empty: <StatefulTags initial={[]} />,
    filled: <StatefulTags initial={["oncall@example.com"]} />,
    disabled: <TagsInput disabled value={["oncall@example.com"]} onValueChange={() => {}} />,
  },
  {
    name: "SecretInput",
    kind: "type",
    empty: <StatefulSecret stored={false} />,
    filled: <StatefulSecret stored />,
  },
  {
    name: "Textarea",
    kind: "type",
    empty: <Textarea placeholder="Describe what this alert means" />,
    filled: <Textarea defaultValue="Checkout error rate is above budget." />,
    disabled: <Textarea disabled defaultValue="Checkout error rate is above budget." />,
  },
  {
    name: "FilterCombobox",
    kind: "pick",
    empty: <StatefulFilter label="Service" placeholder="All services" queryKey="filter-empty" />,
    filled: (
      <StatefulFilter
        label="Service"
        placeholder="All services"
        queryKey="filter-filled"
        initial={["checkout-api", "edge-gateway"]}
      />
    ),
  },
  {
    name: "OptionCombobox",
    kind: "pick",
    empty: <StatefulOption initial={null} />,
    filled: <StatefulOption initial="webhook" />,
  },
  {
    name: "SuggestCombobox",
    kind: "pick",
    empty: <StatefulSuggest initial="" />,
    filled: <StatefulSuggest initial="checkout-api" />,
  },
  {
    name: "Select",
    kind: "pick",
    empty: <SeveritySelect />,
    filled: <SeveritySelect />,
    disabled: <SeveritySelect disabled />,
  },
  {
    name: "ToggleGroup (outline)",
    kind: "pick",
    empty: <StatusToggle />,
    filled: <StatusToggle />,
  },
  {
    name: "TimeRangePicker",
    kind: "pick",
    empty: <StatefulTimeRange />,
    filled: <StatefulTimeRange />,
  },
  {
    name: "RefreshPicker",
    kind: "pick",
    empty: <StatefulRefresh />,
    filled: <StatefulRefresh />,
  },
  {
    name: "Switch",
    kind: "pick",
    empty: <Switch aria-label="Poll" />,
    filled: <Switch aria-label="Poll" defaultChecked />,
    disabled: <Switch aria-label="Poll" disabled defaultChecked />,
  },
  {
    name: "Button (outline)",
    kind: "action",
    empty: (
      <Button variant="outline" className="w-full justify-start">
        <PlusIcon data-icon="inline-start" />
        Filter
      </Button>
    ),
    filled: (
      <Button variant="outline" className="w-full">
        Cancel
      </Button>
    ),
    disabled: (
      <Button variant="outline" disabled className="w-full">
        Cancel
      </Button>
    ),
  },
  {
    name: "Button (secondary)",
    kind: "action",
    empty: (
      <Button variant="secondary" className="w-full">
        Edit
      </Button>
    ),
    filled: (
      <Button variant="secondary" className="w-full">
        Edit
      </Button>
    ),
  },
  {
    name: "Button (ghost)",
    kind: "action",
    empty: (
      <Button variant="ghost" className="w-full">
        Clear
      </Button>
    ),
    filled: (
      <Button variant="ghost" className="w-full">
        Clear
      </Button>
    ),
  },
  {
    name: "Button (default)",
    kind: "action",
    empty: <Button className="w-full">Apply</Button>,
    filled: <Button className="w-full">Apply</Button>,
  },
];

const kinds = {
  type: "Type a value",
  pick: "Pick a value",
  action: "Do something",
} as const;

const meta = {
  title: "Overview/Fields and controls",
  parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Every field and control at the same width, grouped by what it is for, with
 * the computed fill, border and shadow under each. Hover and focus them to
 * compare those states too.
 */
export const SideBySide: Story = {
  render: () => (
    <div className="flex flex-col gap-10">
      {(Object.keys(kinds) as Row["kind"][]).map((kind) => (
        <section key={kind} className="flex flex-col gap-3">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {kinds[kind]}
          </h2>
          <div className="grid grid-cols-[10rem_repeat(3,16rem)] items-start gap-x-6 gap-y-5">
            <span />
            <span className="text-muted-foreground text-xs">Empty</span>
            <span className="text-muted-foreground text-xs">Filled</span>
            <span className="text-muted-foreground text-xs">Disabled</span>
            {rows
              .filter((row) => row.kind === kind)
              .map((row) => (
                <Cells key={row.name} row={row} />
              ))}
          </div>
        </section>
      ))}
    </div>
  ),
};

function Cells({ row }: { row: Row }) {
  return (
    <>
      <span className="pt-2 text-xs">{row.name}</span>
      <Surface>{row.empty}</Surface>
      <Surface>{row.filled}</Surface>
      {row.disabled ? <Surface>{row.disabled}</Surface> : <span />}
    </>
  );
}

/** The traces filter rail, where comboboxes, inputs and a toggle group stack. */
export const FilterRail: Story = {
  render: () => (
    <div className="flex w-64 flex-col gap-4">
      <StatefulFilter label="Service" placeholder="All services" queryKey="rail-service" />
      <StatefulFilter
        label="Environment"
        placeholder="All environments"
        queryKey="rail-environment"
      />
      <StatefulSearch initial="" />
      <div className="flex flex-col gap-1">
        <Label className="text-muted-foreground text-xs">Status</Label>
        <StatusToggle />
      </div>
      <StatefulFilter label="Namespace" placeholder="All" queryKey="rail-namespace" />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="min-ms" className="text-muted-foreground text-xs">
            Min ms
          </Label>
          <Input id="min-ms" type="number" placeholder="—" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="max-ms" className="text-muted-foreground text-xs">
            Max ms
          </Label>
          <Input id="max-ms" type="number" placeholder="—" />
        </div>
      </div>
      <Button variant="outline" className="w-full justify-start">
        <PlusIcon data-icon="inline-start" />
        Filter
      </Button>
    </div>
  ),
};

/** The size of the text the reader sees: the input or label inside a group,
 *  not the wrapper's inherited 16px. */
function textSize(target: HTMLElement): string {
  const text =
    target.querySelector<HTMLElement>("input, textarea, [data-slot=select-value], span") ?? target;
  return getComputedStyle(text).fontSize;
}

/** Visible shadow layers: Tailwind pads box-shadow with transparent ring
 *  layers, which would otherwise count. */
function shadowLayers(boxShadow: string): string {
  if (boxShadow === "none") return "none";
  const visible = boxShadow
    .split(/,\s*(?=oklch|oklab|rgb|#)/)
    .filter((layer) => !/^(rgba\(0, 0, 0, 0\)|#0000)|\/ 0\)/.test(layer));
  return visible.length ? `${visible.length} layers` : "none";
}
