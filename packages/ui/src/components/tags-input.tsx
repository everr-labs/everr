import { Badge } from "@everr/ui/components/badge";
import { cn } from "@everr/ui/lib/utils";
import { XIcon } from "lucide-react";
import { useRef, useState } from "react";

const TAG_SEPARATORS = /[\s,;]+/;

function TagsInput({
  value,
  onValueChange,
  placeholder,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  value: string[];
  onValueChange: (value: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function addTags(raw: string) {
    const next = [...value];
    for (const item of raw.split(TAG_SEPARATORS)) {
      const tag = item.trim();
      if (!tag || next.includes(tag)) continue;
      next.push(tag);
    }
    if (next.length !== value.length) onValueChange(next);
    setDraft("");
  }

  function removeTag(tag: string) {
    onValueChange(value.filter((item) => item !== tag));
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: click forwards focus to the inner input
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users reach the inner input by tabbing
    <div
      data-slot="tags-input"
      className={cn(
        "border-border bg-input/30 hover:bg-input/45 bg-clip-padding outline-2 outline-dotted outline-transparent outline-offset-2 ring-offset-background focus-within:border-ring focus-within:ring-primary focus-within:ring-2 focus-within:ring-offset-[3px] flex min-h-8 w-full cursor-text flex-wrap items-center gap-1 rounded-md border px-2 py-1 transition-[outline,outline-offset,box-shadow,background-color,border-color] duration-200 ease-[cubic-bezier(0.19,1,0.22,1)]",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="font-mono">
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            data-icon="inline-end"
            className="text-muted-foreground hover:text-destructive focus-visible:ring-primary focus-visible:text-destructive -mr-0.5 inline-flex items-center justify-center rounded-full outline-none focus-visible:ring-2"
            disabled={disabled}
            onClick={() => removeTag(tag)}
          >
            <XIcon className="size-2.5" />
          </button>
        </Badge>
      ))}
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        placeholder={value.length === 0 ? placeholder : undefined}
        disabled={disabled}
        value={draft}
        className="placeholder:text-muted-foreground min-w-24 flex-1 bg-transparent text-sm outline-none md:text-xs/relaxed"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            if (draft.trim()) addTags(draft);
          } else if (
            event.key === "Backspace" &&
            draft === "" &&
            value.length > 0
          ) {
            removeTag(value[value.length - 1]);
          }
        }}
        onPaste={(event) => {
          event.preventDefault();
          addTags(`${draft} ${event.clipboardData.getData("text")}`);
        }}
        onBlur={() => {
          if (draft.trim()) addTags(draft);
        }}
      />
    </div>
  );
}

export { TagsInput };
