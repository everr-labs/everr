import { Label } from "@everr/ui/components/label";
import { Textarea } from "@everr/ui/components/textarea";
import { useId } from "react";

export function parseAllowedOriginsText(text: string): string[] {
  return [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

export function AllowedOriginsField({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Allowed origins</Label>
      <Textarea
        id={id}
        aria-describedby={`${id}-help`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={"https://app.example.com\n*.preview.example.com\nhttp://localhost:5173"}
        rows={3}
        required
        disabled={disabled}
      />
      <p id={`${id}-help`} className="text-muted-foreground text-xs">
        Enter one origin per line, with a scheme, an optional port, and no path. Use{" "}
        <code>*.example.com</code> for one level of HTTPS subdomains.
      </p>
    </div>
  );
}
