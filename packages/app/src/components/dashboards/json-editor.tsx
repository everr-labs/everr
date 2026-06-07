import { json } from "@codemirror/lang-json";
import { CodeEditor } from "./code-editor";

interface JsonEditorProps {
  /** Initial document. The editor mounts once; parents remount via `key` to reset. */
  defaultValue: string;
  onChange: (value: string) => void;
  /** Sizing is left to the parent (e.g. `min-h-0 flex-1` or a fixed height). */
  className?: string;
}

export function JsonEditor({
  defaultValue,
  onChange,
  className,
}: JsonEditorProps) {
  return (
    <CodeEditor
      language={json()}
      defaultValue={defaultValue}
      onChange={onChange}
      className={className}
    />
  );
}
