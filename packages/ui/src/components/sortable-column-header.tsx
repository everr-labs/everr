import { ArrowUpDown } from "lucide-react";
import { Button } from "@everr/ui/components/button";

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
