import { Button } from "@everr/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@everr/ui/components/dialog";
import { Input } from "@everr/ui/components/input";
import { Label } from "@everr/ui/components/label";
import { useEffect, useState } from "react";

interface NameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  initialName?: string;
  confirmLabel: string;
  isPending?: boolean;
  onConfirm: (name: string) => void;
}

export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  initialName = "",
  confirmLabel,
  isPending,
  onConfirm,
}: NameDialogProps) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  const handleConfirm = () => {
    if (name.trim() && !isPending) onConfirm(name.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="name-dialog-input">Name</Label>
          <Input
            id="name-dialog-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
            }}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!name.trim() || isPending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
