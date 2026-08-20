import { Input } from "@everr/ui/components/input";
import { SearchIcon } from "lucide-react";

/** The search field pinned above a rail's rows. */
export function RailSearch({
  label,
  value,
  onChange,
}: {
  /** Names what is being searched, for the placeholder and the field itself. */
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        placeholder={`Search ${label}...`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-8"
        aria-label={`Search ${label}`}
      />
    </div>
  );
}
