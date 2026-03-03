import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface FilterSelectProps {
  value?: string;
  placeholder: string;
  onChange: (value: string | undefined) => void;
  items: string[];
  triggerClassName?: string;
}

export function FilterSelect({
  value,
  placeholder,
  onChange,
  items,
  triggerClassName = "w-45",
}: FilterSelectProps) {
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
        {items.map((item) => (
          <SelectItem key={item} value={item}>
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
