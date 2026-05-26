import { Button } from "@everr/ui/components/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@everr/ui/components/toggle-group";
import { Search, X } from "lucide-react";
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
  return (
    <div className="flex flex-col gap-2 border-b bg-muted/10 px-3 py-2">
      <form
        className="flex min-w-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          onChange({ q: String(form.get("q") ?? "").trim() });
        }}
      >
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            name="q"
            defaultValue={value.q}
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
            onClick={() => onChange({ q: "" })}
          >
            <X />
          </Button>
        ) : null}
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          value={[value.sort]}
          size="sm"
          variant="outline"
          spacing={0}
          onValueChange={(next) => {
            const selected = next[0];
            if (selected === "lastSeen" || selected === "count") {
              onChange({ sort: selected });
            }
          }}
          aria-label="Error issue sort"
        >
          <ToggleGroupItem value="lastSeen" aria-label="Last seen">
            Last seen
          </ToggleGroupItem>
          <ToggleGroupItem value="count" aria-label="Count">
            Count
          </ToggleGroupItem>
        </ToggleGroup>

        <div className="flex min-w-0 flex-wrap gap-1">
          {services.map((service) => {
            const active = value.service.includes(service);
            return (
              <Button
                key={service}
                type="button"
                variant={active ? "default" : "outline"}
                size="sm"
                onClick={() =>
                  onChange({
                    service: active
                      ? value.service.filter((item) => item !== service)
                      : [...value.service, service],
                  })
                }
              >
                {service}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
