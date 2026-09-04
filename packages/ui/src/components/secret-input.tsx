import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@everr/ui/components/input-group";
import { cn } from "@everr/ui/lib/utils";
import { LockKeyhole } from "lucide-react";
import { useState } from "react";

type SecretInputProps = Omit<
  React.ComponentProps<"input">,
  "defaultValue" | "onChange" | "value"
> & {
  /** Whether a write-only value already exists outside this form. */
  hasStoredSecret?: boolean;
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * A write-only input that makes replacing a stored secret an explicit action.
 * New secrets remain ordinary inputs. Stored secrets start read-only, then
 * reveal an empty replacement field only after the reader chooses Edit.
 */
function SecretInput({
  className,
  disabled,
  hasStoredSecret = false,
  onValueChange,
  type = "password",
  value,
  ...props
}: SecretInputProps) {
  const [editing, setEditing] = useState(false);
  const locked = hasStoredSecret && !editing && value.length === 0;

  if (locked) {
    return (
      <InputGroup className="h-8" data-disabled={disabled || undefined}>
        <InputGroupAddon>
          <LockKeyhole aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          {...props}
          className={cn("text-muted-foreground", className)}
          value="Stored securely"
          disabled={disabled}
          name={undefined}
          readOnly
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            disabled={disabled}
            aria-label="Edit secret"
            onClick={() => setEditing(true)}
          >
            Edit
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    );
  }

  return (
    <InputGroup className="h-8" data-disabled={disabled || undefined}>
      <InputGroupInput
        {...props}
        autoFocus={hasStoredSecret}
        className={className}
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
      />
      {hasStoredSecret && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            disabled={disabled}
            aria-label="Cancel editing secret"
            onClick={() => {
              onValueChange("");
              setEditing(false);
            }}
          >
            Cancel
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

export type { SecretInputProps };
export { SecretInput };
