import { Button } from "@everr/ui/components/button";
import { FilterCombobox } from "@everr/ui/components/filter-combobox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import { Label } from "@everr/ui/components/label";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { Search, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { ErrorSort } from "@/data/errors/types";

export type ErrorFiltersValue = {
  q: string;
  service: string[];
  fingerprint: string;
  sort: ErrorSort;
  limit: number;
};

export function ErrorFilters({
  value,
  services,
  onChange,
}: {
  value: ErrorFiltersValue;
  services: string[];
  onChange: (patch: Partial<ErrorFiltersValue>) => void;
}) {
  const [qDraft, setQDraft] = useState(value.q);
  const orderLabelId = useId();
  const serviceOptions = [
    ...services,
    ...value.service.filter((service) => !services.includes(service)),
  ];
  const serviceFilterOptions = {
    queryKey: ["errors", "service-filter-options", serviceOptions] as const,
    queryFn: async () => serviceOptions,
    select: (data: string[]) => data,
  };

  useEffect(() => {
    setQDraft(value.q);
  }, [value.q]);

  return (
    <div className="flex flex-col gap-2 border-b bg-muted/10 px-3 py-2">
      <form
        className="flex min-w-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onChange({ q: qDraft.trim() });
        }}
      >
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            name="q"
            value={qDraft}
            onChange={(event) => setQDraft(event.currentTarget.value)}
            placeholder="Search errors"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" size="sm">
              Search
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {value.q ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Clear search"
            onClick={() => {
              setQDraft("");
              onChange({ q: "" });
            }}
          >
            <X />
          </Button>
        ) : null}
      </form>

      <div className="flex flex-wrap items-start gap-2">
        <FilterCombobox
          label="Service"
          values={value.service}
          onChange={(nextServices) => onChange({ service: nextServices })}
          options={serviceFilterOptions}
          placeholder="All services"
          searchPlaceholder="Search services..."
        />

        <div className="flex flex-col gap-1">
          <Label id={orderLabelId} className="text-muted-foreground text-xs">
            Order
          </Label>
          <ToggleGroup
            value={[value.sort]}
            size="lg"
            variant="outline"
            spacing={0}
            onValueChange={(next) => {
              const selected = next[0];
              if (selected === "lastSeen" || selected === "count") {
                onChange({ sort: selected });
              }
            }}
            aria-labelledby={orderLabelId}
          >
            <ToggleGroupItem value="lastSeen" aria-label="Last seen">
              Last seen
            </ToggleGroupItem>
            <ToggleGroupItem value="count" aria-label="Count">
              Count
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </div>
  );
}
