import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@everr/ui/components/avatar";
import { cn } from "@everr/ui/lib/utils";
import { UserIcon } from "lucide-react";

interface SenderCellProps {
  sender: string | undefined;
  className?: string;
}

export function SenderCell({ sender, className }: SenderCellProps) {
  if (!sender) return <span className={className}>—</span>;

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <Avatar size="xs">
        <AvatarImage src={`https://github.com/${sender}.png?s=48`} />
        <AvatarFallback>
          <UserIcon className="size-2.5" />
        </AvatarFallback>
      </Avatar>
      {sender}
    </span>
  );
}
