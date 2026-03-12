import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface FilterSelectItem {
  value: string;
  label: string;
}

interface FilterSelectProps {
  value?: string;
  placeholder: string;
  onChange: (value: string | undefined) => void;
  items: Array<string | FilterSelectItem>;
  triggerClassName?: string;
}

export function FilterSelect({
  value,
  placeholder,
  onChange,
  items,
  triggerClassName = "w-45",
}: FilterSelectProps) {
  const normalizedItems = items.map((item) =>
    typeof item === "string" ? { value: item, label: item } : item,
  );

  return (
    <Select
      value={value === "__all__" ? undefined : value}
      onValueChange={(v) =>
        onChange(v === "__all__" || v == null ? undefined : v)
      }
    >
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={undefined}>{placeholder}</SelectItem>
        {normalizedItems.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
