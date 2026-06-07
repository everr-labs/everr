import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  placeholder as cmPlaceholder,
  EditorView,
  keymap,
} from "@codemirror/view";
import { cn } from "@everr/ui/lib/utils";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

interface CodeEditorProps {
  /** CodeMirror language extension (e.g. sql({...}) or json()). */
  language: Extension;
  /** Initial document. The editor mounts once; parents remount via `key` to reset. */
  defaultValue: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Sizing is left to the parent (e.g. `min-h-0 flex-1` or a fixed height). */
  className?: string;
}

export function CodeEditor({
  language,
  defaultValue,
  onChange,
  placeholder = "",
  className,
}: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const handleChange = useRef(
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    }),
  );

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: defaultValue,
      extensions: [
        basicSetup,
        language,
        oneDark,
        handleChange.current,
        cmPlaceholder(placeholder),
        EditorView.theme({
          "&": { height: "100%", fontSize: "12px" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { fontFamily: "var(--font-mono, monospace)" },
        }),
        keymap.of([]),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Only create editor once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "border-border overflow-hidden rounded-md border",
        className,
      )}
    />
  );
}
