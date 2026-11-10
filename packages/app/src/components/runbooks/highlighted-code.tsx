import bash from "highlight.js/lib/languages/bash";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";
import type { LanguageFn } from "highlight.js";
import hljs from "highlight.js/lib/core";
import { createLowlight } from "lowlight";
import { createElement, type ReactNode, use, useMemo } from "react";

/** The parts of lowlight's syntax tree a token renders from. */
interface TokenNode {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: TokenNode[];
}

/** Each language's proper name ("Rust", "C#"), under its id and every alias. */
const names = new Map<string, string>();

function register(grammars: Record<string, LanguageFn>) {
  lowlight.register(grammars);
  for (const [id, grammar] of Object.entries(grammars)) {
    const { name = id, aliases = [] } = grammar(hljs);
    for (const key of [id, ...aliases]) names.set(key.toLowerCase(), name);
  }
}

// The languages runbooks use most ship with the page. Any other one loads
// every grammar highlight.js has, once, the first time a fence needs it.
const lowlight = createLowlight();
register({ bash, go, javascript, json, python, sql, typescript, yaml });

/** Fences that name no language worth loading grammars for. */
const PLAIN = new Set(["text", "txt", "plain", "plaintext"]);

// If the chunk fails to load (a deploy replaced it, the network dropped), the
// blocks waiting on it stay plain rather than failing the page. It isn't
// retried: `use` would ask again on every render, retrying in a loop.
let everyLanguage: Promise<void> | undefined;
function loadEveryLanguage(): Promise<void> {
  everyLanguage ??= import("./every-language").then(
    (grammars) => register(grammars.everyLanguage),
    () => {},
  );
  return everyLanguage;
}

/**
 * The grammar a fence's language names, by its id or any alias, lowercased.
 * Null for no language or a plain one; suspends while a language outside the
 * common set loads.
 */
function useGrammarKey(language: string | undefined): string | null {
  const key = language?.toLowerCase();
  if (!key || PLAIN.has(key)) return null;
  if (!names.has(key)) use(loadEveryLanguage());
  return names.has(key) ? key : null;
}

/** A fence language's proper name, or the language as written when
 * highlight.js doesn't know it. */
export function LanguageName({ language }: { language: string }) {
  const key = useGrammarKey(language);
  return key ? names.get(key) : language;
}

// Tokens are passed as separate children, not an array, so they need no keys:
// they never reorder.
function renderNode(node: TokenNode): ReactNode {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return null;
  const className = node.properties?.className;
  return createElement(
    "span",
    { className: Array.isArray(className) ? className.join(" ") : undefined },
    ...(node.children ?? []).map(renderNode),
  );
}

/** Tokens per line: a token spanning lines is cut at each break, and its
 * parts keep its classes. */
function splitLines(nodes: TokenNode[]): TokenNode[][] {
  const lines: TokenNode[][] = [[]];
  const append = (node: TokenNode) => lines.at(-1)?.push(node);
  for (const node of nodes) {
    const parts =
      node.type === "text"
        ? (node.value ?? "").split("\n").map((value): TokenNode[] => [{ type: "text", value }])
        : node.type === "element"
          ? splitLines(node.children ?? []).map((children) => [{ ...node, children }])
          : [[]];
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      for (const piece of part) append(piece);
    });
  }
  return lines;
}

/** One line of code, marked when the fence highlights it. */
function Line({ tokens, marked }: { tokens: TokenNode[]; marked: boolean }) {
  return createElement(
    "span",
    {
      className: marked
        ? "-mx-4 inline-block min-w-[calc(100%+2rem)] border-l-2 border-primary bg-primary/9 pr-4 pl-[calc(1rem-2px)]"
        : "inline-block min-w-full",
      "data-marked": marked || undefined,
    },
    ...tokens.map(renderNode),
  );
}

/**
 * `code` highlighted as `language`, line by line, with the lines numbered in
 * `marked` (from 1) set apart. A language outside the common set suspends
 * while every grammar loads; one highlight.js doesn't know stays plain, as
 * does a fence with no language.
 */
export function HighlightedCode({
  language,
  code,
  marked,
}: {
  language: string | undefined;
  code: string;
  marked: ReadonlySet<number>;
}) {
  const key = useGrammarKey(language);
  // Not again on a copy or a wrap toggle, which re-render the block.
  const lines = useMemo(
    () =>
      splitLines(key ? lowlight.highlight(key, code).children : [{ type: "text", value: code }]),
    [key, code],
  );
  return createElement(
    "code",
    { className: key ? "hljs" : undefined },
    // Lines stay apart by their breaks, so copying a selection keeps them.
    ...lines.flatMap((line, index) => [
      index > 0 ? "\n" : null,
      createElement(Line, { tokens: line, marked: marked.has(index + 1) }),
    ]),
  );
}
