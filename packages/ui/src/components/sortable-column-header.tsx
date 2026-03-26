import { Button } from "@everr/ui/components/button";
import { ArrowUpDown } from "lucide-react";

export function SortableColumnHeader({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-7 gap-1 text-xs"
      onClick={onClick}
    >
      {label}
      <ArrowUpDown className="size-3" />
    </Button>
  );
}
