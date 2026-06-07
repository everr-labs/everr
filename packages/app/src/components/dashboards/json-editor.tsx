import { json } from "@codemirror/lang-json";
import { jsonSchema } from "codemirror-json-schema";
import { CodeEditor } from "./code-editor";

/** The JSON Schema shape `codemirror-json-schema` consumes (draft-7). */
export type JsonEditorSchema = NonNullable<Parameters<typeof jsonSchema>[0]>;

interface JsonEditorProps {
  /** Initial document. The editor mounts once; parents remount via `key` to reset. */
  defaultValue: string;
  onChange: (value: string) => void;
  /**
   * Optional JSON Schema powering inline lint squiggles, autocompletion and
   * hover tooltips. Advisory only — submit-time validation stays with the caller.
   */
  schema?: JsonEditorSchema;
  /** Sizing is left to the parent (e.g. `min-h-0 flex-1` or a fixed height). */
  className?: string;
}

export function JsonEditor({
  defaultValue,
  onChange,
  schema,
  className,
}: JsonEditorProps) {
  return (
    <CodeEditor
      language={schema ? jsonSchema(schema) : json()}
      defaultValue={defaultValue}
      onChange={onChange}
      className={className}
    />
  );
}
